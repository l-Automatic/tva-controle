import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { verifierCoherenceCompteImmobilisation } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionListe } from './db/dossierRepository.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère de immobilisation_sur_compte_tva_incorrect
// (10/08) — "Vérifier à nouveau", un seul bouton, pas de qualification
// préalable : vraie erreur de saisie certaine (même famille que
// tva_hotel_a_tort et autoliquidation_desequilibree/incomplete). Aucun
// ajustement du calcul — bloque simplement la validation. Les comptes
// d'immobilisation (comptes_immobilisation) font déjà partie des 6
// catégories du popup de catégorisation principal, donc déjà garantis
// confirmés par la porte obligatoire existante avant qu'un cycle parte —
// aucun risque de silence à corriger ici, contrairement aux deux
// précédentes anomalies de cette revue.
export interface ParametresVerificationImmobilisationTva {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function verifierImmobilisationTvaLegere(
  pool: Pool,
  params: ParametresVerificationImmobilisationTva
): Promise<{ anomaliesOuvertes: number }> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const comptesImmobilisation = conventionListe(contexteDossier, 'comptes_immobilisation') ?? [];

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

  const anomaliesFraiches = verifierCoherenceCompteImmobilisation(ecritures, { comptesImmobilisation });

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['immobilisation_sur_compte_tva_incorrect'],
      anomaliesFraiches
    )
  );

  return { anomaliesOuvertes: anomaliesFraiches.length };
}
