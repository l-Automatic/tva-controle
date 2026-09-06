import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { verifierAutoliquidationEquilibree, verifierExhaustiviteAutoliquidation } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur, conventionListe } from './db/dossierRepository.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère de autoliquidation_desequilibree ET
// autoliquidation_incomplete (10/08) — un seul bouton "Vérifier à
// nouveau" pour les deux, pas de qualification préalable : vraies
// erreurs de saisie certaines, jamais une question d'appréciation (même
// famille que tva_hotel_a_tort). Couvre BTP et intracom en un seul appel
// pour chacune. Aucun ajustement du calcul — ces deux anomalies bloquent
// la validation, elles ne touchent jamais le montant de TVA lui-même
// (l'autoliquidation est neutre par nature).
//
// Suppose les comptes déjà confirmés (portes obligatoires construites le
// même jour, cf. verifierComptesTvaAConfirmer pour due/déductible, et
// l'extension de verifierComptesACategoriser pour comptes_charge_autoliquidation)
// — si l'un des comptes d'une paire n'est pas confirmé, cette paire est
// simplement ignorée ici, comme dans le cycle complet.
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
  const comptesChargeAutoliquidation = conventionListe(contexteDossier, 'comptes_charge_autoliquidation') ?? [];
  const comptesChargeAutoliquidationIntracom =
    conventionListe(contexteDossier, 'comptes_charge_autoliquidation_intracom') ?? [];

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

  const anomaliesEquilibre = [
    ...(compteDue && compteDeductible ? verifierAutoliquidationEquilibree(ecritures, compteDue, compteDeductible) : []),
    ...(compteDueIntracom && compteDeductibleIntracom
      ? verifierAutoliquidationEquilibree(ecritures, compteDueIntracom, compteDeductibleIntracom)
      : []),
  ];

  const anomaliesExhaustivite = [
    ...(compteDue && compteDeductible && comptesChargeAutoliquidation.length > 0
      ? verifierExhaustiviteAutoliquidation(ecritures, {
          comptesChargeAutoliquidation,
          compteTvaDueAutoliquidee: compteDue,
          compteTvaDeductibleAutoliquidee: compteDeductible,
        })
      : []),
    ...(compteDueIntracom && compteDeductibleIntracom && comptesChargeAutoliquidationIntracom.length > 0
      ? verifierExhaustiviteAutoliquidation(ecritures, {
          comptesChargeAutoliquidation: comptesChargeAutoliquidationIntracom,
          compteTvaDueAutoliquidee: compteDueIntracom,
          compteTvaDeductibleAutoliquidee: compteDeductibleIntracom,
        })
      : []),
  ];

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['autoliquidation_desequilibree'],
      anomaliesEquilibre
    )
  );
  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['autoliquidation_incomplete'],
      anomaliesExhaustivite
    )
  );

  return { anomaliesOuvertes: anomaliesEquilibre.length + anomaliesExhaustivite.length };
}
