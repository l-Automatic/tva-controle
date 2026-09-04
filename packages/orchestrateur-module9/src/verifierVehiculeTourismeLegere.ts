import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import type { Anomalie } from '@tva-controle/core';
import { avecContexteCabinet } from './db/pool.js';
import { listerAnomalies } from './db/readRepository.js';
import { enregistrerAnomaliesPartielles, appliquerCorrectionVehiculeTourisme } from './db/writeRepository.js';

// Vérification ciblée et légère de immobilisation_vehicule_tourisme_a_verifier
// (10/08) — mécanisme "Vérifier à nouveau", même principe que
// verifierAvoirsLegere : l'anomalie reste ouverte si la TVA est toujours
// déduite sur cette ligne précise, disparaît et ajuste le calcul si elle
// a été corrigée côté Pennylane. Contrairement aux avoirs, jamais besoin
// de rappeler le jugement IA ici : le libellé d'une ligne déjà signalée
// n'a aucune raison d'avoir changé de sens — seul le fait qu'elle soit
// encore déduite ou non a besoin d'être revérifié.
export interface ParametresVerificationVehiculeTourisme {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
  utilisateurId: string;
}

export async function verifierVehiculeTourismeLegere(
  pool: Pool,
  params: ParametresVerificationVehiculeTourisme
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

  const anomaliesOuvertesAvant = (
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      listerAnomalies(client, params.dossierId, { periode: params.periodeDebut, statut: 'ouvert' })
    )
  ).filter((a) => a.typeAnomalie === 'immobilisation_vehicule_tourisme_a_verifier');

  const anomaliesFraiches: Anomalie[] = [];
  let corrections = 0;

  for (const ancienne of anomaliesOuvertesAvant) {
    const ledgerEntryId = Number(ancienne.referencePiece);
    const nouveauDebit = ligneParId.get(ledgerEntryId)?.debit ?? 0;

    if (nouveauDebit > 0) {
      // Toujours déduit : reste ouverte, reconstruite à l'identique — pas
      // besoin de rappeler l'IA, le libellé n'a aucune raison d'avoir
      // changé de sens pour une ligne déjà signalée.
      anomaliesFraiches.push({
        type: 'immobilisation_vehicule_tourisme_a_verifier',
        gravite: 'signale',
        ledgerEntryId,
        compte: ancienne.compte ?? '44562',
        description: ancienne.description,
        details: (ancienne.details as Record<string, unknown> | null) ?? undefined,
      });
      continue;
    }

    // Corrigée : la TVA n'est plus déduite sur cette ligne.
    const details = ancienne.details as { montantDeduit?: number } | null;
    const delta = -(details?.montantDeduit ?? 0);
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      appliquerCorrectionVehiculeTourisme(
        client,
        params.dossierId,
        params.periodeDebut,
        delta,
        `Véhicule de tourisme corrigé (vérifié à nouveau) : ${delta.toFixed(2)} € retirés de la TVA déductible.`,
        params.utilisateurId
      )
    );
    corrections += 1;
  }

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['immobilisation_vehicule_tourisme_a_verifier'],
      anomaliesFraiches
    )
  );

  return { anomaliesOuvertes: anomaliesFraiches.length, corrections };
}
