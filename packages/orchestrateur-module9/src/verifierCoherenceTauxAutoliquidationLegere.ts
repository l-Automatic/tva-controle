import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { verifierCoherenceTauxAutoliquidation } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur } from './db/dossierRepository.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère de incoherence_taux_autoliquidation
// (10/08) — "Vérifier à nouveau", un seul bouton, pas de qualification
// préalable. Signalée (pas bloquante) — contrairement aux autres
// contrôles autoliquidation de cette revue (tous bloquants, erreur de
// saisie certaine), celui-ci est une déduction statistique (taux
// dominant observé), un écart peut être légitime. Couvre BTP et intracom
// en un seul appel. Aucun ajustement du calcul.
export interface ParametresVerificationTauxAutoliquidation {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function verifierCoherenceTauxAutoliquidationLegere(
  pool: Pool,
  params: ParametresVerificationTauxAutoliquidation
): Promise<{ anomaliesOuvertes: number }> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const compteDeductible = conventionValeur(contexteDossier, 'compte_tva_deductible_autoliquidee');
  const compteDeductibleIntracom = conventionValeur(contexteDossier, 'compte_tva_deductible_autoliquidee_intracom');

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

  const anomaliesFraiches = [
    ...(compteDeductible
      ? verifierCoherenceTauxAutoliquidation(ecritures, { compteTvaDeductibleAutoliquidee: compteDeductible })
      : []),
    ...(compteDeductibleIntracom
      ? verifierCoherenceTauxAutoliquidation(ecritures, { compteTvaDeductibleAutoliquidee: compteDeductibleIntracom })
      : []),
  ];

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['incoherence_taux_autoliquidation'],
      anomaliesFraiches
    )
  );

  return { anomaliesOuvertes: anomaliesFraiches.length };
}
