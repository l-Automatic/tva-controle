import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { verifierAutoliquidationEquilibree } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur } from './db/dossierRepository.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère de autoliquidation_desequilibree (10/08) —
// "Vérifier à nouveau", un seul bouton, pas de qualification préalable :
// vraie erreur de saisie certaine, jamais une question d'appréciation
// (même famille que tva_hotel_a_tort). Couvre BTP et intracom en un seul
// appel. Aucun ajustement du calcul — cette anomalie bloque la validation,
// elle ne touche jamais le montant de TVA lui-même (l'autoliquidation est
// neutre par nature).
//
// Suppose les comptes déjà confirmés (porte obligatoire construite le même
// jour, cf. verifierComptesTvaAConfirmer) — si l'un des deux comptes d'une
// paire n'est pas confirmé, cette paire est simplement ignorée ici, comme
// dans le cycle complet.
export interface ParametresVerificationAutoliquidation {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function verifierAutoliquidationLegere(
  pool: Pool,
  params: ParametresVerificationAutoliquidation
): Promise<{ anomaliesOuvertes: number }> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const compteDue = conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee');
  const compteDeductible = conventionValeur(contexteDossier, 'compte_tva_deductible_autoliquidee');
  const compteDueIntracom = conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee_intracom');
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
    ...(compteDue && compteDeductible ? verifierAutoliquidationEquilibree(ecritures, compteDue, compteDeductible) : []),
    ...(compteDueIntracom && compteDeductibleIntracom
      ? verifierAutoliquidationEquilibree(ecritures, compteDueIntracom, compteDeductibleIntracom)
      : []),
  ];

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['autoliquidation_desequilibree'],
      anomaliesFraiches
    )
  );

  return { anomaliesOuvertes: anomaliesFraiches.length };
}
