import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import type { EcritureTvaComplete } from '@tva-controle/core';
import {
  identifierComptesACategoriser,
  identifierComptesServiceSansSousCategorieAutoliquidation,
  type CompteACategoriser,
} from '@tva-controle/controles-module4';
import { MistralClient, suggererCategorisationComptes, type SuggestionCategorisation } from '@tva-controle/connector-mistral';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionListe } from './db/dossierRepository.js';
import { parametreCabinetValeur } from './db/readRepository.js';

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
  // Performance (10/08, ~100s constatées sur un vrai dossier — bug réel
  // confirmé par Claude Code, instrumentation réelle) : les 4 portes
  // obligatoires refaisaient chacune le même aller-retour Pennylane
  // (balance -> écritures) pour la même période, de façon totalement
  // redondante. Quand chargerPortesObligatoires (l'agrégateur) fournit
  // ces écritures déjà chargées, on les réutilise directement au lieu
  // de les récupérer une seconde fois — l'appelant standalone (route
  // /comptes-a-categoriser, pipeline.ts) continue de fonctionner sans
  // rien changer, ce paramètre reste optionnel.
  ecrituresPreChargees?: EcritureTvaComplete[];
}

export interface ResultatVerificationCategorisation {
  comptesACategoriser: CompteACategoriser[];
  comptesServiceSansSousCategorieAutoliquidation: CompteACategoriser[];
  // Suggestion IA (10/08, demandée à plusieurs reprises par Rami, jamais
  // construite jusqu'ici) — jamais appliquée automatiquement, juste une
  // aide à la décision. Tableau vide si aucune clé Mistral configurée
  // pour ce cabinet, ou si l'appel échoue — jamais bloquant pour le
  // popup lui-même.
  suggestions: SuggestionCategorisation[];
}

export async function verifierComptesACategoriser(
  pool: Pool,
  params: ParametresVerificationCategorisation
): Promise<ResultatVerificationCategorisation> {
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
    comptesVenteIntracomExoneree: conventionListe(contexteDossier, 'comptes_vente_intracom_exoneree') ?? [],
    comptesSansCategorie: conventionListe(contexteDossier, 'comptes_sans_categorie') ?? [],
  });

  const comptesServiceSansSousCategorieAutoliquidation = identifierComptesServiceSansSousCategorieAutoliquidation(
    ecritures,
    comptesChargeService,
    conventionListe(contexteDossier, 'comptes_charge_autoliquidation') ?? [],
    conventionListe(contexteDossier, 'comptes_charge_autoliquidation_rejetee') ?? []
  );

  let suggestions: SuggestionCategorisation[] = [];
  if (comptesACategoriser.length > 0) {
    const mistralApiKey = await avecContexteCabinet(pool, params.cabinetId, (client) =>
      parametreCabinetValeur(client, params.cabinetId, 'mistral_api_key')
    );
    if (typeof mistralApiKey === 'string' && mistralApiKey.length > 0) {
      try {
        const mistralClient = new MistralClient({ apiKey: mistralApiKey });
        suggestions = await suggererCategorisationComptes(
          mistralClient,
          comptesACategoriser.map((c) => ({ compte: c.compte, exemplesLibelle: c.exemplesLibelle }))
        );
      } catch (err) {
        if (process.env.DEBUG_CYCLE) {
          console.error(`[DEBUG_CYCLE] échec suggestion IA catégorisation : ${String(err)}`);
        }
        // Aucune suggestion : jamais une erreur qui empêche d'afficher le popup lui-même.
      }
    }
  }

  return { comptesACategoriser, comptesServiceSansSousCategorieAutoliquidation, suggestions };
}
