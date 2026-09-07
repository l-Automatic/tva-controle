import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { avecContexteCabinet } from './db/pool.js';
import { listerAnomalies } from './db/readRepository.js';
import { appliquerCorrectionFraisVehicule } from './db/writeRepository.js';

const TYPES_FRAIS_VEHICULE = ['entretien_vehicule_tourisme_deduit_a_tort', 'location_vehicule_tourisme_deduite_a_tort'];

// Vérification ciblée et légère des deux anomalies frais véhicule tourisme
// (10/08) — "Vérifier à nouveau", couvre les deux types confirmés en un
// seul appel. Même principe exactement que verifierTvaHotelLegere pour la
// partie "confirmé" : ne rejoue jamais le jugement IA (le libellé n'a
// aucune raison d'avoir changé de sens pour une ligne déjà signalée),
// vérifie juste si la TVA est toujours déduite sur cette ligne précise.
export interface ParametresVerificationFraisVehicule {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
  utilisateurId: string;
}

export async function verifierFraisVehiculeLegere(
  pool: Pool,
  params: ParametresVerificationFraisVehicule
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
  const ligneParId = new Map(ecritures.map((e) => [e.ligneTva.ledgerEntryId, e.ligneTva]));

  const anomaliesResolues = (
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      listerAnomalies(client, params.dossierId, { periode: params.periodeDebut, statut: 'resolu' })
    )
  ).filter((a) => TYPES_FRAIS_VEHICULE.includes(a.typeAnomalie));

  let corrections = 0;
  let toujoursOuvertes = 0;

  for (const ancienne of anomaliesResolues) {
    const ledgerEntryId = Number(ancienne.referencePiece);
    const nouveauDebit = ligneParId.get(ledgerEntryId)?.debit ?? 0;
    if (nouveauDebit > 0) {
      toujoursOuvertes += 1;
      continue; // toujours déduit, rien de corrigé
    }

    const details = ancienne.details as { montantDeduit?: number } | null;
    const montantTva = details?.montantDeduit ?? 0;
    if (montantTva <= 0) continue;

    await avecContexteCabinet(pool, params.cabinetId, async (client) => {
      await appliquerCorrectionFraisVehicule(
        client,
        params.dossierId,
        params.periodeDebut,
        montantTva,
        `Frais véhicule corrigé (vérifié à nouveau) : ${montantTva.toFixed(2)} € retirés de la TVA déductible.`,
        params.utilisateurId
      );
      await client.query(`UPDATE anomalies SET statut = 'obsolete' WHERE id = $1`, [ancienne.id]);
    });
    corrections += 1;
  }

  return { anomaliesOuvertes: toujoursOuvertes, corrections };
}
