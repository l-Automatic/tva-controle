import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { verifierCoherenceTauxProduit } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère de incoherence_taux_produit (10/08) —
// "Vérifier à nouveau", un seul bouton, pas de qualification préalable :
// vraie erreur de saisie certaine (même famille que tva_hotel_a_tort,
// autoliquidation_desequilibree/incomplete, et
// immobilisation_sur_compte_tva_incorrect). Aucun ajustement du calcul —
// bloque simplement la validation.
export interface ParametresVerificationTauxProduit {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function verifierCoherenceTauxProduitLegere(
  pool: Pool,
  params: ParametresVerificationTauxProduit
): Promise<{ anomaliesOuvertes: number }> {
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

  const anomaliesFraiches = verifierCoherenceTauxProduit(ecritures);

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['incoherence_taux_produit'],
      anomaliesFraiches
    )
  );

  return { anomaliesOuvertes: anomaliesFraiches.length };
}
