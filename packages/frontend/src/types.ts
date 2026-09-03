export type GraviteAnomalie = 'bloquant' | 'signale' | 'info';
export type StatutAnomalie = 'ouvert' | 'resolu' | 'justifie';

export interface Anomalie {
  id: string;
  dossierId: string;
  periode: string;
  typeAnomalie: string;
  gravite: GraviteAnomalie;
  referencePiece: string | null;
  compte: string | null;
  description: string;
  details: unknown;
  statut: StatutAnomalie;
  resolution: unknown;
  createdAt: string;
}

// Qualification dédiée aux anomalies 'encaissement_non_affecte' (compte
// d'attente 471) — décision structurée, pas un simple commentaire libre.
export type QualificationEncaissement =
  | { decision: 'vente'; taux: number }
  | { decision: 'hors_vente'; motif: string };

export type StatutProposition = 'candidate' | 'confirmed' | 'rejected';

export interface Proposition {
  id: string;
  dossierId: string;
  cle?: string;
  compteProduitOuCharge?: string;
  numeroCompteTiers?: string;
  valeur?: unknown;
  tauxHabituel?: number;
  statut: StatutProposition;
  source: string;
  confidenceNote?: string | null;
}

export interface ApiErrorBody {
  erreur: string;
}

// Les 6 conventions de comptes configurables via l'écran dédié — chacune
// prend une liste de numéros de compte (`valeur` en JSONB côté API).
// Distinctes des conventions à valeur unique (ex: compte_tva_due_autoliquidee),
// gérées par le panneau générique "Conventions". `comptes_cadeaux` est la
// 5ᵉ catégorie (brief v6) — cadeaux clients, TVA jamais déductible dessus.
// `comptes_immobilisation` est la 6ᵉ (brief v9) — distincte de
// `comptes_equipement` malgré le libellé proche : sert au contrôle bloquant
// qui signale une TVA déductible saisie en 44566 au lieu de 44562 sur ces
// comptes (cf. coherenceCompteImmobilisation.ts côté backend).
export const CLES_CONVENTIONS_COMPTES = [
  'comptes_vente_service',
  'comptes_charge_service',
  'comptes_equipement',
  'comptes_carburant',
  'comptes_cadeaux',
  'comptes_immobilisation',
] as const;
export type CleConventionCompte = (typeof CLES_CONVENTIONS_COMPTES)[number];

export const LIBELLE_CLE_CONVENTION: Record<CleConventionCompte, string> = {
  comptes_vente_service: 'Comptes de vente de service',
  comptes_charge_service: 'Comptes de charge de service',
  comptes_equipement: 'Comptes d’équipement (immobilisations)',
  comptes_carburant: 'Comptes de carburant',
  comptes_cadeaux: 'Cadeaux clients',
  comptes_immobilisation: 'Comptes d’immobilisation',
};

// --- Cycle TVA (Module 9) ---

export interface AnomalieCycle {
  type: string;
  gravite: GraviteAnomalie;
  ledgerEntryId: number;
  compte: string;
  description: string;
  details?: Record<string, unknown>;
}

export interface LigneCalcul {
  categorie: string;
  montant: number;
  referencesPieces: number[];
}

export interface EcritureExclue {
  ledgerEntryId: number;
  compte: string;
  motif: string;
}

export interface ResultatCalculCycle {
  lignes: LigneCalcul[];
  tvaNette: number;
  sens: 'a_decaisser' | 'credit';
  ecrituresExclues: EcritureExclue[];
}

// Présélection IA (brief v10) — premier usage du LLM (Mistral) dans le
// projet. Purement une suggestion : absente si aucune clé Mistral n'est
// configurée pour le cabinet ou si l'appel a échoué (dégradation gracieuse
// côté backend), jamais garantie d'être présente. Ne doit jamais permettre
// une validation sans geste conscient de l'utilisateur (cf. brief v10,
// contexte).
export type ConfianceSuggestionIA = 'haute' | 'moyenne' | 'basse';

// `source` (brief v11) : 'plan_comptable' = déduit d'un référentiel
// déterministe (aucun appel réseau, aucune erreur possible sur ces cas) —
// distinct d'une suggestion IA, ne doit pas porter de niveau de confiance.
// Absente ou 'ia' = comportement historique (badge de confiance).
export type SourceSuggestionIA = 'ia' | 'plan_comptable';

export interface SuggestionIA {
  compte: string;
  categorieSuggeree: string | null;
  confiance: ConfianceSuggestionIA;
  justification: string;
  source?: SourceSuggestionIA;
}

// Comptes produit/charge mouvementés sur la période mais absents des 6
// conventions de comptes — popup de catégorisation (brief v2). `suggestionIA`
// ajoutée en v10 : présélection optionnelle, jamais une auto-validation.
export interface CompteACategoriser {
  compte: string;
  exemplesLibelle: string[];
  suggestionIA?: SuggestionIA;
}

// --- Rapprochement des paiements achats (brief v34) — deux portes
// obligatoires avant un cycle, avec la catégorisation ci-dessus : POST
// /dossiers/:dossierId/cycles refuse désormais (409) tant qu'il reste des
// comptes à catégoriser ou des factures de service à rapprocher, jamais
// rattrapé après coup contrairement à encaissement_non_affecte.

export interface CandidatPaiementPopup {
  ledgerEntryId: number;
  libelle: string | null;
  montant: number;
  date: string;
  precoche: boolean;
  // null = pas de précochage (IA non configurée, ou n'a pas pu se
  // prononcer) — jamais un message d'erreur, juste rien de coché.
  confiance: ConfianceSuggestionIA | null;
}

export interface FactureARapprocher {
  ledgerEntryId: number;
  // Ajoutés en v35, à afficher en premier — identifier immédiatement de
  // quoi il s'agit sans avoir à déduire l'information depuis le libellé
  // de l'écriture seul.
  compteFournisseur: string;
  libelleCompteFournisseur: string | null;
  libelle: string | null;
  montantFactureTotal: number;
  date: string;
  candidats: CandidatPaiementPopup[];
}

export interface ParametresRapprochementPaiementAchat {
  periode: string;
  factureLedgerEntryId: number;
  montantFactureTotal: number;
  paiementsValides: { ledgerEntryId: number; montant: number }[];
  utilisateurId: string;
}

// Comptes produit/charge (classes 6/7) mouvementés sans taux assigné, et
// comptes clients mouvementés sans taux historique ni assignation manuelle
// — suggestions pour l'onglet Taux assigné (brief v4, section 4), même
// principe que comptesACategoriser mais pour le taux plutôt que la
// convention.
export interface CompteSansTauxAssigne {
  compte: string;
  exemplesLibelle: string[];
}

export interface CompteClientSansTauxAssigne {
  numeroCompteTiers: string;
  nomTiers: string | null;
}

// Le calcul se produit désormais toujours, dès le premier cycle, même
// incomplet — statut 'bloque' retiré (brief v31) : POST /cycles ne renvoie
// plus jamais que 'calcule'. anomaliesBloquantesOuvertes remplace l'ancien
// blocage : 0 = calcul complet et validable, > 0 = produit mais incomplet
// tant que ces anomalies restent ouvertes (le blocage se déplace à la
// validation, cf. Calcul ci-dessous et POST /calculs/:id/valider).
// Paiements partiels réellement appliqués (brief v35) — remplace
// l'ancienne anomalie paiement_partiel_calcule, retirée du catalogue.
// sens='collecte' (ventes) : à afficher dans le panneau de calcul,
// jamais dans le panneau Anomalies. sens='deductible' (achats) : déjà
// visible dans le popup de rapprochement des paiements achats (v34), pas
// dupliqué ailleurs pour ce sens-là.
export interface ProrataApplique {
  ledgerEntryId: number;
  compte: string;
  compteTiers: string;
  prorata: number;
  sens: 'collecte' | 'deductible';
}

export interface ResultatCycle {
  statut: 'calcule';
  anomalies: AnomalieCycle[];
  resultat: ResultatCalculCycle;
  calculId: string;
  anomaliesBloquantesOuvertes: number;
  comptesACategoriser: CompteACategoriser[];
  comptesSansTauxAssigne: CompteSansTauxAssigne[];
  comptesClientSansTaux: CompteClientSansTauxAssigne[];
  comptesAutoliquidationSuggeres: CompteACategoriser[];
  prorataAppliques: ProrataApplique[];
}

// --- Calculs persistés (panneau "Calculs") ---

export type StatutCalcul = 'brouillon' | 'valide' | 'declare' | 'rejete';

export interface Calcul {
  id: string;
  periodeDebut: string;
  periodeFin: string;
  statut: StatutCalcul;
  tvaNette: number;
  sens: 'a_decaisser' | 'credit';
  // Recalculé en direct à chaque GET /dossiers/:id/calculs (brief v31),
  // jamais figé au moment du cycle qui a produit ce brouillon — résoudre
  // une anomalie fait baisser ce nombre au prochain chargement.
  anomaliesBloquantesOuvertes: number;
}

// --- Paramétrage (cabinet + dossier) ---

export interface Parametre {
  cle: string;
  valeur: unknown;
  updatedAt: string;
}

// --- Dossiers (sélection) ---

export type StatutDossier = 'onboarding' | 'actif' | 'inactif';

export interface Dossier {
  id: string;
  nom: string;
  siren: string | null;
  statut: StatutDossier;
  regimeTva: string;
}

// --- Identité complète d'un dossier (brief v29) — champs synchronisés
// depuis Pennylane (nom, nomCommercial, siren, adresse, ville, codePostal,
// codeNaf) + champs saisis manuellement, en lecture/écriture via
// PUT /dossiers/:dossierId/identite.

export type Fiscalite = 'is' | 'ir';
export const LIBELLE_FISCALITE: Record<Fiscalite, string> = { is: 'IS', ir: 'IR' };

export type Comptabilite = 'engagement' | 'tresorerie';
export const LIBELLE_COMPTABILITE: Record<Comptabilite, string> = {
  engagement: 'Engagement',
  tresorerie: 'Trésorerie',
};

export const FORMES_JURIDIQUES_COURANTES = ['EI', 'EURL', 'SARL', 'SAS', 'SASU', 'SA'] as const;

export interface DossierComplet {
  id: string;
  nom: string;
  nomCommercial: string | null;
  siren: string | null;
  siret: string | null;
  formeJuridique: string | null;
  fiscalite: Fiscalite | null;
  comptabilite: Comptabilite | null;
  dateDebutExercice: string | null;
  dateFinExercice: string | null;
  regimeTva: string;
  periodiciteDeclaration: string;
  tvaEncaissement: boolean;
  numeroTvaIntracom: string | null;
  adresse: string | null;
  ville: string | null;
  codePostal: string | null;
  codeNaf: string | null;
  emailContact: string | null;
  contactNom: string | null;
  contactTelephone: string | null;
  logicielSource: string;
  statut: StatutDossier;
  motifDesactivation: string | null;
}

// Sous-ensemble éditable via le formulaire d'identité — seuls les champs
// présents dans le body sont modifiés côté backend (mise à jour partielle).
export interface InfosIdentiteDossier {
  siret?: string | null;
  formeJuridique?: string | null;
  fiscalite?: Fiscalite | null;
  comptabilite?: Comptabilite | null;
  dateDebutExercice?: string | null;
  dateFinExercice?: string | null;
  emailContact?: string | null;
  contactNom?: string | null;
  contactTelephone?: string | null;
  numeroTvaIntracom?: string | null;
}

// --- Point d'entrée "à traiter" ---

export type TypeElementATraiter =
  | 'anomalie_bloquante'
  | 'convention_candidate'
  | 'taux_candidate'
  | 'taux_tiers_candidate'
  | 'calcul_brouillon';

export interface ElementATraiter {
  type: TypeElementATraiter;
  id: string;
  resume: string;
}

// --- Tiers de référence (mémoire de confiance — Module 9) ---

export type NiveauConfianceTiers = 'nouveau' | 'a_surveiller' | 'confiance';

export interface TiersReference {
  numeroCompteTiers: string;
  nomTiers: string | null;
  niveauConfiance: NiveauConfianceTiers;
  nbControlesSansAnomalie: number;
  derniereDateControle: string | null;
}

// --- Taux assigné par compte (produit/charge) — assignation directe, pas
// de workflow candidate/confirmed. Prévu pour un futur contrôle de
// cohérence de fin d'exercice (pas encore construit). ---

export const VALEURS_TAUX_ASSIGNE = [
  '0',
  '2.1',
  '5.5',
  '10',
  '20',
  'autoliquide_intracom',
  'autoliquide_20',
  'autoliquide_10',
  'autoliquide_5.5',
  // Plusieurs taux légitimement appliqués sur ce compte selon les cas
  // (brief v22, migration 011) — n'affecte que la suggestion, aucun
  // contrôle ne compare ce taux à autre chose pour l'instant.
  'mixte',
] as const;
export type TauxAssigne = (typeof VALEURS_TAUX_ASSIGNE)[number];

export const LIBELLE_TAUX_ASSIGNE: Record<TauxAssigne, string> = {
  '0': 'Exonéré (0%)',
  '2.1': '2,1%',
  '5.5': '5,5%',
  '10': '10%',
  '20': '20%',
  autoliquide_intracom: 'Intracommunautaire (taux non précisé)',
  autoliquide_20: 'Intracommunautaire - 20%',
  autoliquide_10: 'Intracommunautaire - 10%',
  'autoliquide_5.5': 'Intracommunautaire - 5,5%',
  mixte: 'Mixte (plusieurs taux)',
};

export interface TauxAssigneEntry {
  compte: string;
  tauxAssigne: TauxAssigne;
  updatedAt: string;
}

// --- Dégradés du volet latéral (brief v7) — palette sombre et premium,
// chaque dégradé nuance une seule teinte (pas un mélange de deux couleurs)
// vers une variante légèrement plus claire d'elle-même, stockée comme
// paramètre dossier (`theme_degrade`), jamais cabinet. Remplace intégralement
// la palette vive de la v2. La variante claire du taupe est volontairement
// moins éclaircie que les autres (~5% au lieu de ~20%) : au-delà, le texte
// blanc du volet tombe sous le seuil de contraste WCAG AA (4.5:1) — c'est la
// seule des 9 couleurs assez claire pour que ça se voit. ---

export const CLE_THEME_DEGRADE = 'theme_degrade';

export const DEGRADES_SIDEBAR = [
  'linear-gradient(135deg, #2A0F2E, #553F58)', // violet très foncé
  'linear-gradient(135deg, #0F5757, #3F7979)', // sarcelle foncé
  'linear-gradient(135deg, #003D3D, #336464)', // vert-bleu très foncé
  'linear-gradient(135deg, #191919, #474747)', // quasi noir
  'linear-gradient(135deg, #3A2D28, #615753)', // brun foncé
  'linear-gradient(135deg, #80685C, #867064)', // taupe/mocha
  'linear-gradient(135deg, #49111C, #6D4149)', // bordeaux très foncé
  'linear-gradient(135deg, #142174, #434D90)', // bleu roi profond
  'linear-gradient(135deg, #61053B, #813762)', // magenta/lie-de-vin foncé
] as const;
export const DEGRADE_PAR_DEFAUT: string = DEGRADES_SIDEBAR[7]; // bleu roi, cohérent avec l'accent existant

export type ActeurAudit = 'agent' | 'utilisateur' | 'systeme';

export interface AuditEvenement {
  id: string;
  dossierId: string | null;
  typeEvenement: string;
  moduleSource: string;
  acteur: ActeurAudit;
  acteurUtilisateurId: string | null;
  acteurNom: string | null;
  details: unknown;
  horodatage: string;
}

// --- Parc de véhicules (brief v6) — confirmé immédiatement, pas de
// candidate/confirmed, alimente le contrôle "flotte mixte" / déductibilité
// carburant déjà existant côté véhicules tourisme. ---

export const TYPES_BIEN_VEHICULE = ['vehicule_tourisme', 'vehicule_utilitaire', 'autre'] as const;
export type TypeBienVehicule = (typeof TYPES_BIEN_VEHICULE)[number];

export const LIBELLE_TYPE_BIEN_VEHICULE: Record<TypeBienVehicule, string> = {
  vehicule_tourisme: 'Véhicule de tourisme',
  vehicule_utilitaire: 'Véhicule utilitaire',
  autre: 'Autre',
};

export interface Vehicule {
  id: string;
  designation: string | null;
  typeBien: TypeBienVehicule;
  montantHt: number | null;
  dateAcquisition: string | null;
  statut: 'candidate' | 'confirmed' | 'rejected';
}

// --- Régime TVA sur encaissement (brief v6) — nouveau paramètre dossier,
// détermine le traitement par défaut d'un encaissement client sans facture
// rapprochée (cf. encaissementClientNonAffecte.ts côté backend). ---

export const CLE_REGIME_TVA_ENCAISSEMENT = 'regime_tva_encaissement';

export const VALEURS_REGIME_TVA_ENCAISSEMENT = ['service', 'bien', 'mixte'] as const;
export type RegimeTvaEncaissement = (typeof VALEURS_REGIME_TVA_ENCAISSEMENT)[number];

export const LIBELLE_REGIME_TVA_ENCAISSEMENT: Record<RegimeTvaEncaissement, string> = {
  service: "Prestations de service (TVA à l'encaissement)",
  bien: 'Vente de biens ou encaissement comptant (TVA à la facturation)',
  mixte: 'Mixte (par défaut prudent)',
};

// --- Motif de numérotation de facture (brief v12) — déclenchement manuel
// uniquement (jamais à chaque cycle), le motif proposé est automatiquement
// enregistré côté backend comme convention candidate 'motif_numerotation_facture'
// (visible dans Conventions génériques, cf. analyserMotifNumerotation.ts). ---

export const CLE_MOTIF_NUMEROTATION = 'motif_numerotation_facture';

export interface MotifNumerotation {
  prefixe: string;
  suffixe: string;
  nombreChiffres: number | null;
  description: string;
}

// --- Ajustement manuel des montants de TVA (brief v23) — additif côté
// backend : montantOriginal ne représente jamais la valeur d'un ajustement
// précédent, toujours ce que le moteur de calcul a produit (préservé
// automatiquement par le backend à travers plusieurs modifications). Portée
// volontairement limitée au résultat fraîchement calculé (CycleForm) : c'est
// le seul endroit où les deux totaux collectée/déductible (dérivés des
// lignes du calcul) sont connus côté frontend — ni GET /calculs ni le
// journal d'audit ne les exposent pour un calcul déjà persisté. ---

export type TypeMontantAjustement = 'collectee_totale' | 'deductible_totale';

export interface AjustementCalcul {
  typeMontant: TypeMontantAjustement;
  montantOriginal: number;
  montantAjuste: number;
  justification: string;
  createdAt: string;
}

// --- Authentification (brief v25) — remplace l'ancienne identité saisie à
// la main (cabinetId/utilisateurId tapés dans le volet latéral) par une
// vraie connexion email/mot de passe. Le jeton dure 12h, aucun
// renouvellement automatique dans cette v1. ---

export type Role = 'collaborateur' | 'admin_cabinet';

export const LIBELLE_ROLE: Record<Role, string> = {
  collaborateur: 'Collaborateur',
  admin_cabinet: 'Administrateur cabinet',
};

export interface UtilisateurConnecte {
  id: string;
  cabinetId: string;
  role: Role;
}

export interface Session {
  jeton: string;
  utilisateur: UtilisateurConnecte;
}

// Gestion des utilisateurs (admin_cabinet uniquement) — aUnMotDePasse:false
// signale un utilisateur créé mais qui n'a encore jamais pu se connecter
// (mot de passe jamais défini).
export interface UtilisateurCabinet {
  id: string;
  nom: string;
  email: string;
  role: Role;
  statut: string;
  aUnMotDePasse: boolean;
}

// --- Chantier API Cabinet (brief v27) — le jeton Pennylane vient
// maintenant d'un paramètre cabinet (pennylane_firm_api_key), le dossier
// ciblé de son propre external_company_id. Plus rien à fournir
// manuellement pour lancer un cycle. ---

export const CLE_PENNYLANE_FIRM_API_KEY = 'pennylane_firm_api_key';

export interface DossierSynchronise {
  id: string;
  nom: string;
  nouveau: boolean;
}

export interface ResultatSynchronisationDossiers {
  total: number;
  nouveaux: number;
  dossiers: DossierSynchronise[];
}

// --- Configuration des dossiers nouvellement découverts (brief v28) ---
// regimeTva et periodiciteDeclaration ici concernent la configuration
// fiscale du dossier lui-même (statut onboarding → actif), à ne pas
// confondre avec RegimeTvaEncaissement ci-dessus qui classe un
// encaissement sans facture rapprochée.

export const VALEURS_REGIME_TVA = ['reel_normal', 'reel_simplifie', 'franchise'] as const;
export type RegimeTva = (typeof VALEURS_REGIME_TVA)[number];
export const LIBELLE_REGIME_TVA: Record<RegimeTva, string> = {
  reel_normal: 'Réel normal',
  reel_simplifie: 'Réel simplifié',
  franchise: 'Franchise en base',
};

export const VALEURS_PERIODICITE_DECLARATION = ['mensuelle', 'trimestrielle'] as const;
export type PeriodiciteDeclaration = (typeof VALEURS_PERIODICITE_DECLARATION)[number];
export const LIBELLE_PERIODICITE_DECLARATION: Record<PeriodiciteDeclaration, string> = {
  mensuelle: 'Mensuelle',
  trimestrielle: 'Trimestrielle',
};

export interface ConfigurationOnboarding {
  regimeTva: RegimeTva;
  periodiciteDeclaration: PeriodiciteDeclaration;
  tvaEncaissement: boolean;
}
