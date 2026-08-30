import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import {
  fetchTrialBalance,
  filterComptesParPrefixe,
  fetchEcrituresTvaCompletes,
} from '@tva-controle/connector-pennylane';
import { detecterComptesTvaNonReconnus } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur } from './db/dossierRepository.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère (10/08) — premier exemple d'un mécanisme
// que Rami veut voir se généraliser à d'autres anomalies au fur et à
// mesure de la revue : recalculer UNE anomalie précise sans repasser par
// un cycle complet (lettrage, IA, les ~19 autres contrôles, le calcul
// final). Réutilise exactement la même découverte de comptes 445xx que le
// cycle complet (filterComptesParPrefixe sur la balance) — sans ça, cette
// vérification manquerait justement les comptes non reconnus qu'elle est
// censée détecter.
export interface ParametresVerificationComptesNonReconnus {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function verifierComptesNonReconnus(
  pool: Pool,
  params: ParametresVerificationComptesNonReconnus
): Promise<{ anomalies: number }> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );

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

  const anomalies = detecterComptesTvaNonReconnus(ecritures, {
    compteAutoliquidationDue: conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee'),
    compteAutoliquidationDeductible: conventionValeur(contexteDossier, 'compte_tva_deductible_autoliquidee'),
    compteAutoliquidationDueIntracom: conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee_intracom'),
    compteAutoliquidationDeductibleIntracom: conventionValeur(
      contexteDossier,
      'compte_tva_deductible_autoliquidee_intracom'
    ),
  });

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(client, params.dossierId, params.periodeDebut, ['compte_tva_non_reconnu'], anomalies)
  );

  return { anomalies: anomalies.length };
}
