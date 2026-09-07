import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import {
  identifierComptesACategoriser,
  identifierComptesServiceSansSousCategorieAutoliquidation,
  type CompteACategoriser,
} from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionListe } from './db/dossierRepository.js';

// Vérification légère de la catégorisation bien/service (10/08) — demande
// de Rami : la catégorisation doit être garantie complète AVANT qu'un
// cycle ne parte, pas rattrapée après coup (contrairement à
// encaissement_non_affecte, où un ajustement rétroactif suffit — ici,
// confirmer un compte peut toucher plusieurs écritures à la fois,
// recalculer rétroactivement serait bien plus lourd). Réutilise
// exactement la même chaîne légère que verifierComptesNonReconnus (balance
// -> découverte des comptes 445xx -> écritures), sans LLM ni les autres
// contrôles — appelable à tout moment, y compris comme porte d'entrée
// obligatoire avant le lancement d'un cycle (cf. app.ts, route
// POST /dossiers/:dossierId/cycles).
//
// Étendue le même jour pour couvrir aussi la sous-catégorisation
// autoliquidation (comptes_charge_autoliquidation) — demande de Rami en
// creusant autoliquidation_incomplete : cette sous-catégorisation
// n'avait jusqu'ici QUE la suggestion IA enfouie dans le résultat du
// cycle complet, jamais de vraie porte. Sans elle, comptesChargeAutoliquidation
// retombait silencieusement sur une liste vide, et autoliquidation_incomplete
// ne se déclenchait jamais, même en cas de vraie contrepartie manquante.
export interface ParametresVerificationCategorisation {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export interface ResultatVerificationCategorisation {
  comptesACategoriser: CompteACategoriser[];
  comptesServiceSansSousCategorieAutoliquidation: CompteACategoriser[];
}

export async function verifierComptesACategoriser(
  pool: Pool,
  params: ParametresVerificationCategorisation
): Promise<ResultatVerificationCategorisation> {
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

  const comptesChargeService = conventionListe(contexteDossier, 'comptes_charge_service') ?? [];

  // Bug réel corrigé (10/08, signalé par Claude Code pour comptesVenteExport,
  // élargi en vérifiant : comptesEntretienVehicule et comptesLocationVehicule
  // manquaient aussi ici) — sans ces trois listes, un compte confirmé sous
  // l'une de ces catégories n'était jamais exclu de "à catégoriser", donc
  // re-proposé indéfiniment dans le popup principal malgré la confirmation.
  const comptesACategoriser = identifierComptesACategoriser(ecritures, {
    comptesVenteService: conventionListe(contexteDossier, 'comptes_vente_service') ?? [],
    comptesChargeService,
    comptesEquipement: conventionListe(contexteDossier, 'comptes_equipement') ?? [],
    comptesCarburant: conventionListe(contexteDossier, 'comptes_carburant') ?? [],
    comptesCadeaux: conventionListe(contexteDossier, 'comptes_cadeaux') ?? [],
    comptesImmobilisation: conventionListe(contexteDossier, 'comptes_immobilisation') ?? [],
    comptesEntretienVehicule: conventionListe(contexteDossier, 'comptes_entretien_vehicule') ?? [],
    comptesLocationVehicule: conventionListe(contexteDossier, 'comptes_location_vehicule') ?? [],
    comptesVenteExport: conventionListe(contexteDossier, 'comptes_vente_export') ?? [],
    comptesSansCategorie: conventionListe(contexteDossier, 'comptes_sans_categorie') ?? [],
  });

  const comptesServiceSansSousCategorieAutoliquidation = identifierComptesServiceSansSousCategorieAutoliquidation(
    ecritures,
    comptesChargeService,
    conventionListe(contexteDossier, 'comptes_charge_autoliquidation') ?? [],
    conventionListe(contexteDossier, 'comptes_charge_autoliquidation_rejetee') ?? []
  );

  return { comptesACategoriser, comptesServiceSansSousCategorieAutoliquidation };
}
