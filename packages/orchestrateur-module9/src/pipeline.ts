import type { Pool } from 'pg';
import {
  type IPennylaneApiClient,
  fetchEcrituresTvaCompletes,
  fetchTrialBalance,
  filterComptesParPrefixe,
  fetchLignesParCompte,
  decouvrirComptesParPrefixe,
  resolveLedgerAccounts,
  fetchPieceNumbers,
  fetchLignesGroupeLettrage,
} from '@tva-controle/connector-pennylane';
import {
  executerPreControles,
  determinerExigibiliteTva,
  determinerDeductibiliteCarburant,
  detecterImmobilisationManquee,
  identifierCandidatsJugementVehiculeTourisme,
  verifierCoherenceTauxAutoliquidation,
  verifierCoherenceCompteImmobilisation,
  verifierCoherenceTvaHotel,
  identifierCandidatsJugementHotel,
  detecterTrousNumerotation,
  calculerProrataEncaissement,
  verifierExhaustiviteAutoliquidation,
  type ProrataApplique,
  verifierAbsenceTvaLivraisonIntracom,
  detecterEncaissementsNonAffectes,
  verifierNouveauxTiers,
  detecterEncaissementsClientAAffecter,
  identifierComptesACategoriser,
  chercherDansReferentiel,
  type CompteACategoriser,
  identifierComptesServiceSansSousCategorieAutoliquidation,
  identifierComptesSansTauxAssigne,
  identifierComptesClientSansTaux,
  type CompteSansTauxAssigne,
  type CompteClientSansTauxAssigne,
} from '@tva-controle/controles-module4';
import { calculerTva, integrerRegularisations, type ResultatCalculTva } from '@tva-controle/calcul-module7';
import { analyserTauxHistorique, analyserTauxHistoriqueParTiers } from '@tva-controle/onboarding-module3';
import {
  MistralClient,
  suggererClassificationComptes,
  type SuggestionClassificationCompte,
  jugerLibellesHotel,
  jugerLibellesVehiculeTourisme,
} from '@tva-controle/connector-mistral';
import type { Anomalie } from '@tva-controle/core';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur, conventionListe, conventionObjet } from './db/dossierRepository.js';
import {
  enregistrerAnomalies,
  enregistrerCalcul,
  enregistrerEvenementAudit,
  synchroniserTiersReference,
  enregistrerPropositionsTaux,
  enregistrerPropositionsTauxTiers,
} from './db/writeRepository.js';
import {
  listerLedgerEntryIdsQualifies,
  listerRegularisationsAIntegrer,
  listerAnomaliesTraiteesParTypeEtPiece,
  listerTauxAssignes,
  parametreDossierValeur,
  parametreCabinetValeur,
  listerRapprochementsPaiementAchat,
} from './db/readRepository.js';

export interface ParametresCycleTva {
  cabinetId: string;
  dossierId: string;
  periodeDebut: string;
  periodeFin: string;
  client: IPennylaneApiClient;
  // Découvert automatiquement (comptes 445* ayant un vrai mouvement sur la
  // période, via la balance) si non fourni — override possible pour les
  // tests ou un besoin ponctuel de restreindre le périmètre.
  //
  // Historique : une première version découvrait via la liste brute des
  // comptes (start_with '445'), mais Pennylane active par défaut des
  // dizaines de sous-comptes TVA par pays jamais utilisés (ex: "TVA
  // collectée Portugal à 16%") — même avec enabled=true. Résultat en test
  // réel : un dossier avec de vraies écritures a produit un calcul vide.
  // La balance (déjà scoppée à la période) ne remonte que les comptes avec
  // un solde réellement mouvementé, éliminant ces faux positifs à la racine
  // plutôt que par une liste d'exclusions fragile.
  comptesTvaOverride?: string[];
  // Dérivés de conventions_dossier (comptes_vente_service,
  // comptes_charge_service, comptes_equipement, comptes_carburant) si non
  // fournis ici. Un override reste possible — utile en test, ou pour un
  // dossier pas encore onboardé où rien n'est confirmé en base.
  comptesVenteServiceOverride?: string[];
  comptesChargeServiceOverride?: string[];
  comptesEquipementOverride?: string[];
  comptesCarburantOverride?: string[];
  comptesCadeauxOverride?: string[];
  comptesImmobilisationOverride?: string[];
  // Comptes d'attente (471 par défaut) sur lesquels chercher des encaissements
  // non identifiés — préfixes, pas numéros exacts (comme comptesTva), car un
  // dossier peut subdiviser en plusieurs sous-comptes 471x.
  comptesAttenteOverride?: string[];
  // Préfixe des comptes clients (411 par défaut) sur lesquels chercher des
  // encaissements non lettrés à régulariser (chantier B) — même logique de
  // préfixe que comptesAttenteOverride, un dossier peut avoir des
  // sous-comptes 411xxx par client.
  comptesClientOverride?: string[];
}

// Présélection IA (10/08) : optionnelle, ajoutée après coup à un compte déjà
// détecté déterministiquement — jamais l'inverse. Absente si aucune clé
// Mistral n'est configurée pour ce cabinet, ou si l'appel échoue (dégradation
// gracieuse, cf. plus bas).
export interface CompteACategoriserAvecSuggestion extends CompteACategoriser {
  suggestionIA?: SuggestionClassificationCompte;
}

export interface ResultatCycleTva {
  statut: 'calcule';
  anomalies: Anomalie[];
  resultat: ResultatCalculTva;
  calculId: string;
  // Nombre d'anomalies bloquantes encore ouvertes sur cette période (10/08)
  // — 0 = calcul complet, validable. > 0 = calcul produit mais incomplet
  // ou incertain sur ce point précis ; la validation reste impossible tant
  // que ce nombre n'est pas à 0 (cf. validerCalcul, writeRepository.ts).
  anomaliesBloquantesOuvertes: number;
  comptesACategoriser: CompteACategoriserAvecSuggestion[];
  comptesSansTauxAssigne: CompteSansTauxAssigne[];
  comptesClientSansTaux: CompteClientSansTauxAssigne[];
  comptesAutoliquidationSuggeres: CompteACategoriserAvecSuggestion[];
  // Paiements partiels réellement appliqués (10/08) — remplace l'ancienne
  // anomalie paiement_partiel_calcule. sens='collecte' = ventes, à
  // afficher dans le panneau de calcul ; sens='deductible' = achats, déjà
  // visible dans le popup de rapprochement (présent ici aussi par
  // cohérence, mais redondant avec ce que le popup montre déjà).
  prorataAppliques: ProrataApplique[];
}

// Enchaîne : charge le contexte dossier (Module 2) -> récupère les écritures
// (Module 1) -> exécute tous les contrôles (Module 4) -> persiste les
// anomalies -> calcule (Module 7) et persiste le résultat, même si des
// anomalies bloquantes restent ouvertes (10/08 — seule la validation reste
// bloquée dans ce cas, jamais la production du brouillon).
//
// Les anomalies sont TOUJOURS persistées, même en cas de blocage — c'est
// justement ce qui permet à Module 6 (validation humaine) de les voir et de
// les traiter. Relancer executerCycleTva sur la même période marque les
// anciennes anomalies encore 'ouvert' comme 'obsolete' avant d'insérer le
// nouveau lot (enregistrerAnomalies) — les anomalies déjà traitées
// ('resolu'/'justifie') ne sont, elles, jamais touchées par une relance.
//
// La persistance se fait dans des transactions séparées de la lecture du
// contexte et de l'appel réseau Pennylane, pour ne jamais garder une
// transaction Postgres ouverte pendant une opération lente/externe.
function fusionnerSuggestions(
  comptes: CompteACategoriser[],
  suggestions: SuggestionClassificationCompte[]
): CompteACategoriserAvecSuggestion[] {
  const suggestionParCompte = new Map(suggestions.map((s) => [s.compte, s]));
  return comptes.map((c) => {
    const suggestion = suggestionParCompte.get(c.compte);
    return suggestion ? { ...c, suggestionIA: suggestion } : c;
  });
}

export async function executerCycleTva(
  pool: Pool,
  params: ParametresCycleTva
): Promise<ResultatCycleTva> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );

  const comptesTva =
    params.comptesTvaOverride ??
    (await (async () => {
      const balance = await fetchTrialBalance(params.client, {
        dossierId: params.dossierId,
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
      });
      return filterComptesParPrefixe(balance, ['445'])
        .filter((c) => c.debit !== 0 || c.credit !== 0)
        .map((c) => c.numeroCompte);
    })());

  const ecritures = await fetchEcrituresTvaCompletes(params.client, {
    comptesTva,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  const compteAutoliquidationDue = conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee');
  const compteAutoliquidationDeductible = conventionValeur(
    contexteDossier,
    'compte_tva_deductible_autoliquidee'
  );
  const comptesChargeAutoliquidation = conventionListe(contexteDossier, 'comptes_charge_autoliquidation') ?? [];

  // TVA intracom (10/08) — deuxième paire d'autoliquidation, confirmée
  // séparément du BTP (comptes différents), structurellement parallèle.
  const compteAutoliquidationDueIntracom = conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee_intracom');
  const compteAutoliquidationDeductibleIntracom = conventionValeur(
    contexteDossier,
    'compte_tva_deductible_autoliquidee_intracom'
  );
  const comptesChargeAutoliquidationIntracom =
    conventionListe(contexteDossier, 'comptes_charge_autoliquidation_intracom') ?? [];
  const comptesVenteIntracomExoneree = conventionListe(contexteDossier, 'comptes_vente_intracom_exoneree') ?? [];

  // Dérivés de la mémoire de dossier — [] si le dossier n'a encore aucune
  // convention confirmée pour ce point (ex: pas encore onboardé). Un tableau
  // vide désactive silencieusement la classification "service" correspondante
  // (tout est alors traité comme "bien"/exigible par défaut) plutôt que de
  // faire échouer le cycle — cohérent avec le comportement déjà en place
  // avant que ces contrôles existent.
  const comptesVenteService =
    params.comptesVenteServiceOverride ?? conventionListe(contexteDossier, 'comptes_vente_service') ?? [];
  const comptesChargeService =
    params.comptesChargeServiceOverride ?? conventionListe(contexteDossier, 'comptes_charge_service') ?? [];
  const comptesPaiementComptant = conventionListe(contexteDossier, 'comptes_paiement_comptant') ?? [];
  const comptesEquipement =
    params.comptesEquipementOverride ?? conventionListe(contexteDossier, 'comptes_equipement') ?? [];
  const comptesCarburant =
    params.comptesCarburantOverride ?? conventionListe(contexteDossier, 'comptes_carburant') ?? [];
  const comptesCadeaux =
    params.comptesCadeauxOverride ?? conventionListe(contexteDossier, 'comptes_cadeaux') ?? [];
  const comptesImmobilisation =
    params.comptesImmobilisationOverride ?? conventionListe(contexteDossier, 'comptes_immobilisation') ?? [];
  const comptesSansCategorie = conventionListe(contexteDossier, 'comptes_sans_categorie') ?? [];
  const comptesAttentePrefixes =
    params.comptesAttenteOverride ?? conventionListe(contexteDossier, 'comptes_attente') ?? ['471'];

  // Détection déterministe pour le popup de catégorisation (08/08) — ne
  // dépend que des 4 conventions déjà connues, calculée une fois qu'elles
  // le sont toutes.
  const comptesACategoriser = identifierComptesACategoriser(ecritures, {
    comptesVenteService,
    comptesChargeService,
    comptesEquipement,
    comptesCarburant,
    comptesCadeaux,
    comptesImmobilisation,
    comptesSansCategorie,
  });

  // Comptes déjà "charge de service" mais pas encore marqués spécifiquement
  // autoliquidation — distinct du popup ci-dessus (un compte peut être les
  // deux à la fois, ce n'est pas une catégorie exclusive).
  const comptesChargeAutoliquidationRejetee =
    conventionListe(contexteDossier, 'comptes_charge_autoliquidation_rejetee') ?? [];
  const comptesAutoliquidationBruts = identifierComptesServiceSansSousCategorieAutoliquidation(
    ecritures,
    comptesChargeService,
    comptesChargeAutoliquidation,
    comptesChargeAutoliquidationRejetee
  );

  // Présélection IA (10/08) — premier vrai usage du LLM du projet. Purement
  // additive : si aucune clé Mistral n'est configurée pour ce cabinet, ou
  // si l'appel échoue pour n'importe quelle raison (réseau, quota, réponse
  // malformée), le cycle continue normalement SANS suggestion — jamais un
  // aléa d'un service tiers optionnel ne doit faire échouer un cycle TVA.

  // Référentiel déterministe D'ABORD (10/08) : les comptes que Rami a
  // qualifiés de "toujours X" (601, 604, 611...) n'ont pas besoin de
  // solliciter le LLM du tout — court-circuite l'appel réseau pour ces
  // comptes précis, économie de coût/latence et zéro risque d'erreur du
  // modèle sur un cas qui n'a jamais été ambigu. Cf.
  // referentielComptesCharge.ts pour le détail compte par compte.
  const comptesACategoriserViaReferentiel: CompteACategoriserAvecSuggestion[] = [];
  const comptesACategoriserRestants: CompteACategoriser[] = [];
  for (const c of comptesACategoriser) {
    const entree = chercherDansReferentiel(c.compte);
    if (entree) {
      comptesACategoriserViaReferentiel.push({
        ...c,
        suggestionIA: {
          compte: c.compte,
          categorieSuggeree: entree.categorie,
          confiance: 'haute',
          justification: entree.justification,
          source: 'plan_comptable',
        },
      });
    } else {
      comptesACategoriserRestants.push(c);
    }
  }

  let comptesACategoriserEnrichi: CompteACategoriserAvecSuggestion[] = [
    ...comptesACategoriserViaReferentiel,
    ...comptesACategoriserRestants,
  ];
  let comptesAutoliquidationEnrichi: CompteACategoriserAvecSuggestion[] = comptesAutoliquidationBruts;

  const mistralApiKey = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    parametreCabinetValeur(client, params.cabinetId, 'mistral_api_key')
  );

  if (typeof mistralApiKey === 'string' && mistralApiKey.length > 0) {
    const mistralClient = new MistralClient({ apiKey: mistralApiKey });

    // Bug réel corrigé (10/08) : le LLM classait à tort des comptes en se
    // basant sur le libellé d'UNE écriture prise au hasard dans leur
    // historique (texte libre, spécifique à une transaction), au lieu du
    // NOM OFFICIEL du compte dans le plan comptable. Résolu ici, une seule
    // fois pour l'union des deux listes, avant les deux appels IA.
    const tousLesComptesConcernes = [
      ...new Set([
        ...comptesACategoriserRestants.map((c) => c.compte),
        ...comptesAutoliquidationBruts.map((c) => c.compte),
      ]),
    ];
    const nomsComptes =
      tousLesComptesConcernes.length > 0
        ? await resolveLedgerAccounts(params.client, tousLesComptesConcernes)
        : new Map();

    if (comptesACategoriserRestants.length > 0) {
      try {
        const suggestions = await suggererClassificationComptes(
          mistralClient,
          comptesACategoriserRestants.map((c) => ({ compte: c.compte, nomCompte: nomsComptes.get(c.compte)?.libelle ?? null })),
          [
            { cle: 'comptes_vente_service', description: 'Ventes de prestations de service' },
            { cle: 'comptes_charge_service', description: 'Achats de prestations de service (autoliquidés ou non)' },
            { cle: 'comptes_equipement', description: 'Petit équipement à surveiller pour passage en immobilisation' },
            { cle: 'comptes_carburant', description: 'Achats de carburant' },
            { cle: 'comptes_cadeaux', description: 'Cadeaux offerts aux clients' },
            { cle: 'comptes_immobilisation', description: "Comptes d'immobilisation confirmés (218X, 215X...)" },
          ]
        );
        const restantsEnrichis = fusionnerSuggestions(comptesACategoriserRestants, suggestions);
        comptesACategoriserEnrichi = [...comptesACategoriserViaReferentiel, ...restantsEnrichis];
      } catch (err) {
        if (process.env.DEBUG_CYCLE) {
          console.error(`[DEBUG_CYCLE] échec présélection IA (popup catégorisation) : ${String(err)}`);
        }
      }
    }

    if (comptesAutoliquidationBruts.length > 0) {
      try {
        const suggestions = await suggererClassificationComptes(
          mistralClient,
          comptesAutoliquidationBruts.map((c) => ({
            compte: c.compte,
            nomCompte: nomsComptes.get(c.compte)?.libelle ?? null,
          })),
          [
            {
              cle: 'comptes_charge_autoliquidation',
              description:
                "Compte de charge spécifiquement dédié aux achats de sous-traitance autoliquidée (le nom du compte l'indique généralement, ex: mention explicite d'autoliquidation)",
            },
          ]
        );
        comptesAutoliquidationEnrichi = fusionnerSuggestions(comptesAutoliquidationBruts, suggestions);
      } catch (err) {
        if (process.env.DEBUG_CYCLE) {
          console.error(`[DEBUG_CYCLE] échec présélection IA (compte autoliquidation) : ${String(err)}`);
        }
      }
    }
  }

  // Suggestions pour l'onglet "Taux assigné" (09/08) — comptes mouvementés
  // sans taux encore assigné, produit/charge et client.
  const tauxAssignesExistants = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerTauxAssignes(client, params.dossierId)
  );
  const comptesSansTauxAssigne = identifierComptesSansTauxAssigne(
    ecritures,
    tauxAssignesExistants.map((t) => t.compte)
  );
  // contexteDossier.tauxHistorique contient déjà les taux clients confirmés
  // (fusionnés avec ceux de compte produit/charge dans chargerContexteDossier,
  // cf. dossierRepository.ts) — les comptes 445xxx y figurent aussi
  // (collecte), donc on exclut ce préfixe pour ne garder que les comptes
  // client (411xxx typiquement) déjà connus.
  const comptesClientConnusAvecTaux = contexteDossier.tauxHistorique
    .map((t) => t.compteOuTiers)
    .filter((c) => !c.startsWith('445'));
  const comptesClientSansTaux = identifierComptesClientSansTaux(ecritures, comptesClientConnusAvecTaux);

  const anomaliesPreControles = executerPreControles(ecritures, {
    contexteDossier,
    ...(compteAutoliquidationDue !== undefined ? { compteAutoliquidationDue } : {}),
    ...(compteAutoliquidationDeductible !== undefined ? { compteAutoliquidationDeductible } : {}),
    ...(compteAutoliquidationDueIntracom !== undefined ? { compteAutoliquidationDueIntracom } : {}),
    ...(compteAutoliquidationDeductibleIntracom !== undefined ? { compteAutoliquidationDeductibleIntracom } : {}),
  });

  // Paiement partiel, volet ventes (10/08) — purement déterministe : on
  // récupère les montants complets des groupes de lettrage à plus de 2
  // lignes AVANT d'appeler determinerExigibiliteTva (fonction pure, ne fait
  // jamais d'appel réseau elle-même), puis on lui passe le prorata déjà
  // calculé. Distinct du volet achats juste après : côté ventes, le calcul
  // pur sur la totalité du groupe est fiable (prudence = collecter) ; côté
  // achats, un calcul aveugle sur le groupe entier serait dangereux si
  // plusieurs factures s'y mélangent — d'où le passage par un jugement LLM
  // d'abord, cf. ci-dessous.
  const candidatsProrataVente = ecritures
    .filter((e) => e.ligneTva.compte.startsWith('44571'))
    .map((e) => ({ ledgerEntryId: e.ligneTva.ledgerEntryId, ligneTiers: e.lignesTiers[0] }))
    .filter((c): c is { ledgerEntryId: number; ligneTiers: NonNullable<typeof c.ligneTiers> } =>
      c.ligneTiers !== undefined && c.ligneTiers.lettrage.groupeIds.length > 2
    );
  const prorataParEcriture = new Map<number, number>();
  for (const candidat of candidatsProrataVente) {
    const lignesGroupe = await fetchLignesGroupeLettrage(params.client, candidat.ligneTiers.lettrage.groupeIds);
    prorataParEcriture.set(candidat.ledgerEntryId, calculerProrataEncaissement(lignesGroupe));
  }

  // Contrôle hôtel (10/08) : résout le nom réel des comptes fournisseurs
  // touchés par une ligne déductible ABS (44566) — jamais un libellé
  // d'écriture, même raison que pour la présélection IA plus haut.
  const comptesFournisseurConcernes = [
    ...new Set(
      ecritures
        .filter((e) => e.ligneTva.compte.startsWith('44566'))
        .map((e) => e.lignesTiers[0]?.compte)
        .filter((c): c is string => c !== undefined)
    ),
  ];
  const nomsComptesFournisseur =
    comptesFournisseurConcernes.length > 0
      ? new Map(
          [...(await resolveLedgerAccounts(params.client, comptesFournisseurConcernes)).entries()].map(
            ([numero, resolu]) => [numero, resolu.libelle]
          )
        )
      : new Map<string, string>();
  const anomaliesHotel = verifierCoherenceTvaHotel(ecritures, nomsComptesFournisseur);

  // Jugement LLM sur le libellé (10/08) — extension du contrôle hôtel
  // déterministe ci-dessus, pour les fournisseurs génériques où seul le
  // libellé de l'écriture porte le nom de l'hôtel. Contrairement au
  // contrôle déterministe (bloquant, jamais faux par construction), ce
  // jugement reste 'signale' — une IA ne doit jamais bloquer un cycle
  // seule sur la reconnaissance d'un nom de marque, risque de faux positif
  // réel contrairement à un nom de compte explicite.
  const candidatsJugementHotel = identifierCandidatsJugementHotel(ecritures, nomsComptesFournisseur);
  const anomaliesJugementHotel: Anomalie[] = [];
  if (typeof mistralApiKey === 'string' && mistralApiKey.length > 0 && candidatsJugementHotel.length > 0) {
    try {
      const mistralClientHotel = new MistralClient({ apiKey: mistralApiKey });
      const jugements = await jugerLibellesHotel(mistralClientHotel, candidatsJugementHotel);
      for (const j of jugements.filter((j) => j.estHotel)) {
        // Bug réel corrigé (10/08) : montantTva jamais stocké — sans ça,
        // le futur mécanisme de correction ("Vérifier à nouveau") n'aurait
        // aucun moyen de savoir combien retirer de la TVA déductible une
        // fois la correction constatée.
        const ecritureConcernee = ecritures.find((e) => e.ligneTva.ledgerEntryId === j.ledgerEntryId);
        const montantTva = ecritureConcernee ? Math.abs(ecritureConcernee.ligneTva.debit - ecritureConcernee.ligneTva.credit) : 0;
        anomaliesJugementHotel.push({
          type: 'tva_hotel_a_verifier',
          gravite: 'signale',
          ledgerEntryId: j.ledgerEntryId,
          compte: '44566',
          description: `Le libellé de cette écriture ressemble à une facture d'hôtel (${j.justification}) — si confirmé, la TVA n'est pas déductible. À vérifier manuellement.`,
          details: { confiance: j.confiance, justification: j.justification, montantTva },
        });
      }
    } catch (err) {
      if (process.env.DEBUG_CYCLE) {
        console.error(`[DEBUG_CYCLE] échec jugement IA (hôtel) : ${String(err)}`);
      }
    }
  }

  // Ensemble combiné (déterministe + jugement LLM) des écritures hôtel,
  // utilisé pour exempter ces pièces du court-circuit "paiement comptant"
  // (625) et les inclure dans la recherche d'acompte ci-dessous.
  const ledgerEntryIdsHotel = new Set<number>([
    ...anomaliesHotel.map((a) => a.ledgerEntryId),
    ...anomaliesJugementHotel.map((a) => a.ledgerEntryId),
  ]);

  // Paiement partiel achats — désormais résolu AVANT que le cycle ne
  // parte (10/08, refonte complète demandée par Rami) : le popup de
  // rapprochement (preparerRapprochementsPaiementAchat + validation
  // manuelle du collaborateur, cf. app.ts) est une porte obligatoire au
  // lancement du cycle, exactement comme la catégorisation bien/service.
  // Plus aucun appel LLM ici — tout a déjà été tranché, il ne reste qu'à
  // lire les décisions déjà confirmées en base.
  const rapprochementsConfirmes = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerRapprochementsPaiementAchat(client, params.dossierId, params.periodeDebut)
  );
  for (const r of rapprochementsConfirmes) {
    if (r.montantFactureTotal <= 0) continue; // jamais de division par zéro
    const prorata = Math.min(r.montantTotalValide / r.montantFactureTotal, 1);
    prorataParEcriture.set(r.factureLedgerEntryId, prorata);
  }

  const {
    statuts: statutsExigibilite,
    anomalies: anomaliesExigibilite,
    prorataAppliques,
  } = determinerExigibiliteTva(
    ecritures,
    { comptesVenteService, comptesChargeService, comptesPaiementComptant },
    prorataParEcriture,
    ledgerEntryIdsHotel
  );

  const { statuts: statutsCarburant, anomalies: anomaliesCarburant } = determinerDeductibiliteCarburant(
    ecritures,
    { comptesCarburant },
    contexteDossier
  );

  // Bug réel corrigé (10/08) : referencesDejaVerifiees n'était jamais
  // alimenté ici — un achat de petit équipement déjà résolu/justifié se
  // resignalait indéfiniment à chaque cycle suivant, jamais mémorisé.
  // Même raisonnement que pour ledgerEntryIdsQualifies (encaissements),
  // juste jamais appliqué à cette anomalie précise jusqu'ici.
  const ledgerEntryIdsImmobilisationVerifies = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerLedgerEntryIdsQualifies(client, params.dossierId, 'immobilisation_potentielle_non_passee')
  );
  const anomaliesImmobilisation = detecterImmobilisationManquee(ecritures, {
    comptesEquipement,
    referencesDejaVerifiees: ledgerEntryIdsImmobilisationVerifies,
  });

  // Véhicule de tourisme (10/08, refonte demandée par Rami) : remplace
  // l'ancien signalement systématique de TOUTE ligne 44562 dès qu'un
  // véhicule de tourisme existait quelque part dans le parc — bien trop
  // large, signalait même des achats d'immobilisation sans rapport,
  // indéfiniment. Même schéma que l'hôtel : pré-filtre déterministe
  // (candidats = 2182 avec TVA réellement déduite, controles-module4),
  // puis jugement LLM sur le libellé pour trancher tourisme/utilitaire.
  // Jamais bloquant — un jugement LLM peut se tromper, décision humaine
  // requise (cf. jugerLibellesVehiculeTourisme).
  const candidatsVehiculeTourisme = identifierCandidatsJugementVehiculeTourisme(ecritures);
  const anomaliesVehiculeTourisme: Anomalie[] = [];
  if (candidatsVehiculeTourisme.length > 0 && typeof mistralApiKey === 'string' && mistralApiKey.length > 0) {
    try {
      const mistralClientVehicule = new MistralClient({ apiKey: mistralApiKey });
      const jugementsVehicule = await jugerLibellesVehiculeTourisme(mistralClientVehicule, candidatsVehiculeTourisme);
      for (const j of jugementsVehicule.filter((j) => j.estTourisme && j.confiance !== 'basse')) {
        const ecritureConcernee = ecritures.find((e) => e.ligneTva.ledgerEntryId === j.ledgerEntryId);
        if (!ecritureConcernee) continue;
        anomaliesVehiculeTourisme.push({
          type: 'immobilisation_vehicule_tourisme_a_verifier',
          gravite: 'signale',
          ledgerEntryId: j.ledgerEntryId,
          compte: ecritureConcernee.ligneTva.compte,
          description: `TVA déduite (${ecritureConcernee.ligneTva.debit} €) sur un achat identifié comme véhicule de tourisme (0% déductible, jamais 100%) : "${ecritureConcernee.ligneTva.libelle ?? '(libellé vide)'}". À confirmer.`,
          details: {
            libelle: ecritureConcernee.ligneTva.libelle,
            montantDeduit: ecritureConcernee.ligneTva.debit,
            confiance: j.confiance,
            justification: j.justification,
          },
        });
      }
    } catch (err) {
      if (process.env.DEBUG_CYCLE) {
        console.error(`[DEBUG_CYCLE] échec jugement IA (véhicule tourisme) : ${String(err)}`);
      }
    }
  }

  const anomaliesCoherenceAutoliquidation =
    compteAutoliquidationDeductible !== undefined
      ? verifierCoherenceTauxAutoliquidation(ecritures, { compteTvaDeductibleAutoliquidee: compteAutoliquidationDeductible })
      : [];
  const anomaliesCoherenceCompteImmobilisation = verifierCoherenceCompteImmobilisation(ecritures, {
    comptesImmobilisation,
  });
  const anomaliesExhaustiviteAutoliquidation =
    compteAutoliquidationDue !== undefined && compteAutoliquidationDeductible !== undefined
      ? verifierExhaustiviteAutoliquidation(ecritures, {
          comptesChargeAutoliquidation,
          compteTvaDueAutoliquidee: compteAutoliquidationDue,
          compteTvaDeductibleAutoliquidee: compteAutoliquidationDeductible,
        })
      : [];

  // TVA intracom (10/08) — mêmes contrôles que le BTP, comptes distincts.
  const anomaliesCoherenceAutoliquidationIntracom =
    compteAutoliquidationDeductibleIntracom !== undefined
      ? verifierCoherenceTauxAutoliquidation(ecritures, {
          compteTvaDeductibleAutoliquidee: compteAutoliquidationDeductibleIntracom,
        })
      : [];
  const anomaliesExhaustiviteAutoliquidationIntracom =
    compteAutoliquidationDueIntracom !== undefined && compteAutoliquidationDeductibleIntracom !== undefined
      ? verifierExhaustiviteAutoliquidation(ecritures, {
          comptesChargeAutoliquidation: comptesChargeAutoliquidationIntracom,
          compteTvaDueAutoliquidee: compteAutoliquidationDueIntracom,
          compteTvaDeductibleAutoliquidee: compteAutoliquidationDeductibleIntracom,
        })
      : [];
  const anomaliesLivraisonIntracom = verifierAbsenceTvaLivraisonIntracom(ecritures, comptesVenteIntracomExoneree);


  // Trous de numérotation de facture (10/08) — n'applique que si un motif
  // a déjà été confirmé (via l'endpoint dédié
  // POST /dossiers/:id/motif-numerotation/analyser, déclenché
  // manuellement, jamais automatiquement à chaque cycle). Utilise le vrai
  // piece_number (au niveau de l'écriture), jamais le libellé de ligne —
  // même correction que pour la découverte, cf. analyserMotifNumerotation.ts.
  const motifNumerotationBrut = conventionObjet(contexteDossier, 'motif_numerotation_facture');
  let anomaliesNumerotation: Anomalie[] = [];
  if (motifNumerotationBrut && typeof motifNumerotationBrut === 'object') {
    const ledgerEntryIdsVente = [
      ...new Set(
        ecritures.filter((e) => e.ligneTva.compte.startsWith('44571')).map((e) => e.ligneTva.ledgerEntryId)
      ),
    ];
    const pieceNumbersVente = await fetchPieceNumbers(params.client, ledgerEntryIdsVente);
    if (process.env.DEBUG_CYCLE) {
      console.error(
        `[DEBUG_CYCLE] motif confirmé : ${JSON.stringify(motifNumerotationBrut)}`
      );
      console.error(
        `[DEBUG_CYCLE] ${ledgerEntryIdsVente.length} écriture(s) de vente, piece_numbers reçus : ${JSON.stringify([...pieceNumbersVente.entries()])}`
      );
    }
    anomaliesNumerotation = detecterTrousNumerotation(
      ledgerEntryIdsVente.map((id) => ({ ledgerEntryId: id, numeroPiece: pieceNumbersVente.get(id) ?? null })),
      motifNumerotationBrut as { prefixe: string; suffixe: string; nombreChiffres: number | null }
    );
  }

  // Encaissements en compte(s) d'attente non identifiés (cf. compte 471) —
  // fetch séparé de fetchEcrituresTvaCompletes ci-dessus : ces lignes n'ont
  // par définition aucune ligne TVA associée (c'est justement le problème),
  // donc invisibles pour un fetch ancré sur les comptes 445*.
  const comptesAttente = (
    await Promise.all(comptesAttentePrefixes.map((prefixe) => decouvrirComptesParPrefixe(params.client, prefixe)))
  ).flat();
  const lignesAttente =
    comptesAttente.length > 0
      ? await fetchLignesParCompte(params.client, {
          compteIds: comptesAttente.map((c) => c.id),
          periodeDebut: params.periodeDebut,
          periodeFin: params.periodeFin,
        })
      : [];

  // Filtre les pièces déjà qualifiées lors d'un cycle précédent : sinon,
  // comme la détection relit les mêmes lignes Pennylane à chaque relance
  // (elle ne sait rien de nos décisions passées), un encaissement déjà
  // qualifié re-bloquerait indéfiniment tout nouveau cycle sur la période.
  const ledgerEntryIdsQualifies = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerLedgerEntryIdsQualifies(client, params.dossierId)
  );
  const anomaliesEncaissements = detecterEncaissementsNonAffectes(lignesAttente).filter(
    (a) => !ledgerEntryIdsQualifies.has(a.ledgerEntryId)
  );

  // Chantier B : encaissements sur un compte CLIENT précis (411xxx), non
  // lettrés — distinct du 471 (compte d'attente générique) : ici chaque
  // compte a potentiellement son propre historique de taux. Contrairement
  // au 471, pas de blocage/qualification préalable : un taux par défaut
  // (historique du client si connu, sinon 20% par prudence) est appliqué
  // directement, cf. detecterEncaissementsClientAAffecter.
  const comptesClientPrefixes = params.comptesClientOverride ?? ['411'];
  const comptesClient = (
    await Promise.all(comptesClientPrefixes.map((prefixe) => decouvrirComptesParPrefixe(params.client, prefixe)))
  ).flat();
  const lignesClient =
    comptesClient.length > 0
      ? await fetchLignesParCompte(params.client, {
          compteIds: comptesClient.map((c) => c.id),
          periodeDebut: params.periodeDebut,
          periodeFin: params.periodeFin,
        })
      : [];
  // Régime TVA sur encaissement (09/08) : 'service' par défaut si non
  // paramétré (comportement historique, rétrocompatible avec les dossiers
  // déjà en test). Un dossier vendant des biens (ou fonctionnant en caisse
  // comptant) doit être explicitement basculé sur 'bien' dans les
  // paramètres du dossier, sinon les acomptes sur biens seraient à tort
  // soumis à la règle "collecte à l'encaissement" (art. 269-2-a CGI : pas
  // de TVA sur un acompte de bien).
  const regimeTvaEncaissementBrut = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    parametreDossierValeur(client, params.dossierId, 'regime_tva_encaissement')
  );
  const regimeTvaEncaissement: 'service' | 'bien' | 'mixte' =
    regimeTvaEncaissementBrut === 'bien' || regimeTvaEncaissementBrut === 'mixte' ? regimeTvaEncaissementBrut : 'service';
  const { regularisations: regularisationsClient, anomalies: anomaliesClient } = detecterEncaissementsClientAAffecter(
    lignesClient,
    contexteDossier,
    regimeTvaEncaissement
  );

  const { statuts: statutsTiers, anomalies: anomaliesTiers } = verifierNouveauxTiers(ecritures, contexteDossier);

  const toutesAnomaliesBrutes: Anomalie[] = [
    ...anomaliesPreControles,
    ...anomaliesExigibilite,
    ...anomaliesCarburant,
    ...anomaliesImmobilisation,
    ...anomaliesVehiculeTourisme,
    ...anomaliesCoherenceAutoliquidation,
    ...anomaliesCoherenceCompteImmobilisation,
    ...anomaliesExhaustiviteAutoliquidation,
    ...anomaliesCoherenceAutoliquidationIntracom,
    ...anomaliesExhaustiviteAutoliquidationIntracom,
    ...anomaliesLivraisonIntracom,
    ...anomaliesHotel,
    ...anomaliesJugementHotel,
    ...anomaliesNumerotation,
    ...anomaliesEncaissements,
    ...anomaliesClient,
    ...anomaliesTiers,
  ];

  // Filtre générique anti-doublon (09/08) : une anomalie déjà résolue ou
  // justifiée pour cette même pièce ne doit pas réapparaître à la relance
  // du cycle, quel que soit son type — cf. listerAnomaliesTraiteesParTypeEtPiece.
  // La détection elle-même reste stateless et relit les mêmes écritures à
  // chaque cycle (comme avant), c'est uniquement l'AFFICHAGE/persistance
  // qui est filtré ici, jamais le calcul lui-même (une régularisation déjà
  // intégrée au calcul, ex: chantier B, continue de s'appliquer).
  const anomaliesTraitees = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerAnomaliesTraiteesParTypeEtPiece(client, params.dossierId)
  );
  const toutesAnomalies = toutesAnomaliesBrutes.filter(
    (a) => !anomaliesTraitees.has(`${a.type}:${a.ledgerEntryId}`)
  );

  // enregistrerAnomalies retourne les lignes réellement insérées (avec leur
  // id généré par Postgres) : nécessaire pour référencer les anomalies
  // bloquantes par id dans l'événement d'audit, plutôt qu'un simple décompte.
  const anomaliesInserees = await avecContexteCabinet(pool, params.cabinetId, async (client) => {
    const inserees = await enregistrerAnomalies(client, params.dossierId, params.periodeDebut, toutesAnomalies);

    // Même transaction, volontairement : la mémoire de confiance des tiers
    // avance dès que le contrôle a tourné, indépendamment du fait que le
    // cycle bloque ensuite pour une autre raison (ex: 471 non qualifié) —
    // ce n'est pas lié, pas de raison d'attendre un calcul réussi pour ça.
    await synchroniserTiersReference(client, params.dossierId, statutsTiers, params.periodeFin);

    // Propositions de taux historique (compte produit/charge ET compte
    // tiers) — recalculées à chaque cycle sur les écritures déjà fetchées,
    // mais enregistrerPropositionsTaux(Tiers) ne propose qu'une fois par
    // compte (garde-fou anti-doublon) : ça ne fait rien de plus au-delà du
    // premier cycle pour un compte déjà proposé/tranché. Persisté ici,
    // affiché et confirmé/rejeté via le panneau "Taux historique" déjà
    // existant côté frontend — pas de nouvelle popup nécessaire.
    await enregistrerPropositionsTaux(client, params.dossierId, analyserTauxHistorique(ecritures));
    await enregistrerPropositionsTauxTiers(client, params.dossierId, analyserTauxHistoriqueParTiers(ecritures));

    const parGravite: Record<string, number> = {};
    for (const a of inserees) {
      parGravite[a.gravite] = (parGravite[a.gravite] ?? 0) + 1;
    }

    await enregistrerEvenementAudit(client, {
      dossierId: params.dossierId,
      typeEvenement: 'anomalies_detectees',
      moduleSource: 'module4_controles',
      acteur: 'systeme',
      details: {
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
        total: inserees.length,
        parGravite,
        anomalieIds: inserees.map((a) => a.id),
      },
    });

    return inserees;
  });

  // 10/08 — changement de fond, décidé avec Rami : une anomalie bloquante
  // ne bloque plus la PRODUCTION du calcul, seulement sa VALIDATION
  // (cf. validerCalcul, writeRepository.ts). Le calcul se produit toujours,
  // même incomplet (un compte non reconnu par exemple représente un
  // montant dont on ne connaît pas la taille) — mais reste en brouillon,
  // affiché avec le nombre d'anomalies bloquantes encore ouvertes, jusqu'à
  // ce qu'elles soient résolues. Objectif : un brouillon existe dès le
  // premier cycle, et se met à jour à la résolution de chaque anomalie
  // (cf. option A, qualifierEncaissementNonAffecte) sans jamais avoir
  // besoin de relancer un cycle complet pour ça.
  const anomaliesBloquantes = anomaliesInserees.filter((a) => a.gravite === 'bloquant');
  if (anomaliesBloquantes.length > 0) {
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      enregistrerEvenementAudit(client, {
        dossierId: params.dossierId,
        typeEvenement: 'anomalies_bloquantes_ouvertes',
        moduleSource: 'module9_orchestrateur',
        acteur: 'systeme',
        details: {
          periodeDebut: params.periodeDebut,
          periodeFin: params.periodeFin,
          anomalieIds: anomaliesBloquantes.map((a) => a.id),
        },
      })
    );
  }

  if (process.env.DEBUG_CYCLE) {
    console.error(`[DEBUG_CYCLE] comptesTva découverts : ${JSON.stringify(comptesTva)}`);
    console.error(`[DEBUG_CYCLE] ecritures.length = ${ecritures.length}`);
    console.error(
      `[DEBUG_CYCLE] comptes TVA vus dans ecritures : ${JSON.stringify(
        [...new Set(ecritures.map((e) => e.ligneTva.compte))]
      )}`
    );
    console.error(
      `[DEBUG_CYCLE] statutsExigibilite : ${JSON.stringify(
        statutsExigibilite.map((s) => ({ compte: s.compte, exigible: s.exigible, motif: s.motif }))
      )}`
    );
    console.error(
      `[DEBUG_CYCLE] statutsCarburant : ${JSON.stringify(statutsCarburant)}`
    );
    console.error(
      `[DEBUG_CYCLE] toutesAnomalies (type/compte) : ${JSON.stringify(
        toutesAnomalies.map((a) => ({ type: a.type, compte: a.compte, gravite: a.gravite }))
      )}`
    );
  }

  const resultatBrut = calculerTva(ecritures, toutesAnomalies, statutsExigibilite, statutsCarburant, {
    contexteDossier,
    comptesCadeaux,
    ...(compteAutoliquidationDue !== undefined ? { compteAutoliquidationDue } : {}),
    ...(compteAutoliquidationDeductible !== undefined ? { compteAutoliquidationDeductible } : {}),
    ...(compteAutoliquidationDueIntracom !== undefined ? { compteAutoliquidationDueIntracom } : {}),
    ...(compteAutoliquidationDeductibleIntracom !== undefined ? { compteAutoliquidationDeductibleIntracom } : {}),
  });

  // Encaissements en compte d'attente déjà qualifiés 'vente' par un humain
  // (lors d'un cycle précédent, cf. anomaliesEncaissements plus haut) :
  // intégrés après coup, pas dans calculerTva lui-même — la donnée ne vient
  // pas de `ecritures` mais d'une décision stockée en base. Fusionnées avec
  // les régularisations clients (chantier B, calculées directement plus
  // haut, pas de round-trip DB nécessaire puisqu'un défaut est toujours
  // disponible) — même fonction d'intégration pour les deux, même forme de
  // données (ledgerEntryId, montantTTC, taux).
  const regularisations471 = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerRegularisationsAIntegrer(client, params.dossierId, params.periodeDebut)
  );
  const resultat = integrerRegularisations(resultatBrut, [...regularisations471, ...regularisationsClient]);

  if (process.env.DEBUG_CYCLE) {
    console.error(`[DEBUG_CYCLE] regularisations 471 integrees : ${JSON.stringify(regularisations471)}`);
    console.error(`[DEBUG_CYCLE] regularisations client integrees : ${JSON.stringify(regularisationsClient)}`);
    console.error(`[DEBUG_CYCLE] resultat.lignes : ${JSON.stringify(resultat.lignes)}`);
    console.error(`[DEBUG_CYCLE] resultat.ecrituresExclues : ${JSON.stringify(resultat.ecrituresExclues)}`);
  }

  const calculId = await avecContexteCabinet(pool, params.cabinetId, async (client) => {
    const id = await enregistrerCalcul(client, params.dossierId, params.periodeDebut, params.periodeFin, resultat);

    await enregistrerEvenementAudit(client, {
      dossierId: params.dossierId,
      typeEvenement: 'calcul_genere',
      moduleSource: 'module7_calcul',
      acteur: 'systeme',
      details: {
        calculId: id,
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
        tvaNette: resultat.tvaNette,
        sens: resultat.sens,
      },
    });

    return id;
  });

  return {
    statut: 'calcule',
    anomalies: toutesAnomalies,
    resultat,
    calculId,
    anomaliesBloquantesOuvertes: anomaliesBloquantes.length,
    comptesACategoriser: comptesACategoriserEnrichi,
    comptesSansTauxAssigne,
    comptesClientSansTaux,
    comptesAutoliquidationSuggeres: comptesAutoliquidationEnrichi,
    prorataAppliques,
  };
}
