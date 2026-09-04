import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { detecterImmobilisationManquee } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionListe } from './db/dossierRepository.js';
import { listerAnomalies } from './db/readRepository.js';
import { appliquerTransfertImmobilisation } from './db/writeRepository.js';

// Vérification ciblée et légère de immobilisation_potentielle_non_passee
// (10/08) — mécanisme "Vérifier à nouveau", même principe que les
// précédents (avoirs, véhicule tourisme). Contrairement à ces deux-là,
// pas d'IA ici : la détection est déjà purement déterministe
// (detecterImmobilisationManquee), donc "vérifier à nouveau" rejoue
// simplement ce même contrôle sur des données fraîches, SANS le filtre
// referencesDejaVerifiees (celui-ci filtrerait à tort toute pièce déjà
// qualifiée, empêchant justement de vérifier si la correction promise a
// eu lieu).
export interface ParametresVerificationImmobilisation {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
  utilisateurId: string;
}

export async function verifierImmobilisationLegere(
  pool: Pool,
  params: ParametresVerificationImmobilisation
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const comptesEquipement = conventionListe(contexteDossier, 'comptes_equipement') ?? [];

  const balance = await fetchTrialBalance(params.client, {
    dossierId: params.dossierId,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });
  const comptesTva = filterComptesParPrefixe(balance, ['445'])
    .filter((c) => c.debit !== 0 || c.credit !== 0)
    .map((c) => c.numeroCompte);
  const ecritures = await fetchEcrituresTvaCompletes(params.client, {
    comptesTva,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  // Détection brute, volontairement SANS referencesDejaVerifiees — sinon
  // toute pièce déjà qualifiée (donc 'resolu') serait filtrée à tort,
  // empêchant de savoir si la correction promise a réellement eu lieu.
  const candidatsActuels = detecterImmobilisationManquee(ecritures, { comptesEquipement });
  const idsEncoreCandidats = new Set(candidatsActuels.map((a) => a.ledgerEntryId));

  const anomaliesOuvertesAvant = (
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      listerAnomalies(client, params.dossierId, { periode: params.periodeDebut, statut: 'resolu' })
    )
  ).filter((a) => a.typeAnomalie === 'immobilisation_potentielle_non_passee');

  let corrections = 0;
  let toujoursCandidates = 0;

  for (const ancienne of anomaliesOuvertesAvant) {
    const ledgerEntryId = Number(ancienne.referencePiece);
    if (idsEncoreCandidats.has(ledgerEntryId)) {
      toujoursCandidates += 1;
      continue; // toujours au-dessus du seuil sur le même compte : rien de corrigé
    }

    // N'apparaît plus comme candidate : soit reclassée en immobilisation
    // (transfert à appliquer), soit simplement passée sous le seuil ou le
    // compte a changé de nature — dans les deux cas, le montant original
    // signalé n'est plus une charge à tort, on transfère.
    const details = ancienne.details as { lignes?: { montant: number }[] } | null;
    const montantTotal = (details?.lignes ?? []).reduce((s, l) => s + l.montant, 0);
    if (montantTotal <= 0) continue;

    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      appliquerTransfertImmobilisation(
        client,
        params.dossierId,
        params.periodeDebut,
        montantTotal,
        `Immobilisation corrigée (vérifié à nouveau) : ${montantTotal.toFixed(2)} € transférés de la TVA déductible sur charges vers la TVA déductible sur immobilisations.`,
        params.utilisateurId
      )
    );
    corrections += 1;
  }

  return { anomaliesOuvertes: toujoursCandidates, corrections };
}
