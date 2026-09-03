import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { verifierAvoirs } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { listerAnomalies } from './db/readRepository.js';
import { enregistrerAnomaliesPartielles, appliquerCorrectionAvoir } from './db/writeRepository.js';

// Vérification ciblée et légère de avoir_a_verifier (10/08) — mécanisme
// "Vérifier à nouveau" demandé par Rami. Contrairement aux vérifications
// légères précédentes (comptes non reconnus, catégorisation), celle-ci
// doit aussi CORRIGER le calcul si l'anomalie a disparu : le débit/crédit
// litigieux a potentiellement faussé un montant déjà inclus dans un
// brouillon existant — jamais rattrapable par une simple disparition de
// l'anomalie seule, il faut ajuster le montant réellement affecté.
//
// L'anomalie reste ouverte si le débit/crédit litigieux est toujours
// présent après re-vérification (demande explicite de Rami : jamais
// disparaître tant que ce n'est pas réellement corrigé côté Pennylane).
export interface ParametresVerificationAvoirs {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
  utilisateurId: string;
}

export async function verifierAvoirsLegere(
  pool: Pool,
  params: ParametresVerificationAvoirs
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
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

  const anomaliesFraiches = verifierAvoirs(ecritures);
  const idsEncoreProblematiques = new Set(anomaliesFraiches.map((a) => a.ledgerEntryId));

  const anomaliesOuvertesAvant = (
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      listerAnomalies(client, params.dossierId, { periode: params.periodeDebut, statut: 'ouvert' })
    )
  ).filter((a) => a.typeAnomalie === 'avoir_a_verifier');

  // Recherche rapide de l'état ACTUEL (frais) d'une ligne par son id, pour
  // calculer le delta de correction.
  const ligneParId = new Map(ecritures.map((e) => [e.ligneTva.ledgerEntryId, e.ligneTva]));

  let corrections = 0;
  for (const ancienne of anomaliesOuvertesAvant) {
    const ledgerEntryId = Number(ancienne.referencePiece);
    if (idsEncoreProblematiques.has(ledgerEntryId)) continue; // toujours problématique, rien à ajuster

    const details = ancienne.details as { debit?: number; credit?: number; sens?: 'collecte' | 'deductible' } | null;
    if (!details?.sens) continue; // sécurité — ne devrait jamais arriver pour ce type d'anomalie

    const ligneFraiche = ligneParId.get(ledgerEntryId);
    // Ligne disparue de la période (rare, mais possible si supprimée
    // entre-temps côté Pennylane) : traitée comme totalement à 0 des deux côtés.
    const nouveauDebit = ligneFraiche?.debit ?? 0;
    const nouveauCredit = ligneFraiche?.credit ?? 0;
    const ancienDebit = details.debit ?? 0;
    const ancienCredit = details.credit ?? 0;

    // collecte = credit - debit (un débit y était wrongly soustrait) ;
    // déductible = debit - credit (un crédit y était wrongly soustrait).
    const delta =
      details.sens === 'collecte'
        ? nouveauCredit - nouveauDebit - (ancienCredit - ancienDebit)
        : nouveauDebit - nouveauCredit - (ancienDebit - ancienCredit);

    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      appliquerCorrectionAvoir(
        client,
        params.dossierId,
        params.periodeDebut,
        details.sens!,
        delta,
        `Avoir/OD corrigé (vérifié à nouveau) : ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} € ajustés sur ${
          details.sens === 'collecte' ? 'la TVA collectée' : 'la TVA déductible'
        }.`,
        params.utilisateurId
      )
    );
    corrections += 1;
  }

  // Persiste l'état frais — marque obsolète toute ancienne anomalie
  // corrigée (disparaît), insère à nouveau celles toujours présentes
  // (reste ouverte, comme demandé par Rami).
  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(client, params.dossierId, params.periodeDebut, ['avoir_a_verifier'], anomaliesFraiches)
  );

  return { anomaliesOuvertes: anomaliesFraiches.length, corrections };
}
