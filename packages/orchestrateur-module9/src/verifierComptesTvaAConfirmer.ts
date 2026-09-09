import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import type { Anomalie, EcritureTvaComplete } from '@tva-controle/core';
import { detecterComptesTvaNonReconnus } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur } from './db/dossierRepository.js';

// Version "requête pure" de verifierComptesNonReconnus (10/08, demande de
// Rami) — ne persiste rien, juste une lecture, réutilisable à la fois pour
// l'écran dédié (comptes détectés déjà pré-remplis, plus qu'à confirmer le
// rôle de chacun) et pour la porte obligatoire au lancement d'un cycle,
// même principe exactement que la catégorisation et le parc de véhicules.
// Nécessaire suite au bug corrigé le même jour sur
// verifierAutoliquidationEquilibree : plutôt que de laisser un
// compte_tva_non_reconnu réactif (le collaborateur doit deviner qu'il faut
// aller dans Conventions génériques), le rendre proactif et guidé.
export interface ParametresVerificationComptesTva {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
  // Performance (10/08) — cf. verifierComptesACategoriser.ts, même
  // principe : réutilise les écritures déjà chargées par l'agrégateur
  // plutôt que de refaire le même aller-retour Pennylane.
  ecrituresPreChargees?: EcritureTvaComplete[];
}

export async function verifierComptesTvaAConfirmer(
  pool: Pool,
  params: ParametresVerificationComptesTva
): Promise<Anomalie[]> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );

  const ecritures =
    params.ecrituresPreChargees ??
    (await (async () => {
      const balance = await fetchTrialBalance(params.client, {
        dossierId: params.dossierId,
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
      });
      const comptesTva = filterComptesParPrefixe(balance, ['445'])
        .filter((c) => c.debit !== 0 || c.credit !== 0)
        .map((c) => c.numeroCompte);
      return fetchEcrituresTvaCompletes(params.client, {
        comptesTva,
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
      });
    })());

  return detecterComptesTvaNonReconnus(ecritures, {
    compteAutoliquidationDue: conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee'),
    compteAutoliquidationDeductible: conventionValeur(contexteDossier, 'compte_tva_deductible_autoliquidee'),
    compteAutoliquidationDueIntracom: conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee_intracom'),
    compteAutoliquidationDeductibleIntracom: conventionValeur(
      contexteDossier,
      'compte_tva_deductible_autoliquidee_intracom'
    ),
    compteAutoliquidationDeductibleImmoIntracom: conventionValeur(
      contexteDossier,
      'compte_tva_deductible_autoliquidee_immo_intracom'
    ),
  });
}
