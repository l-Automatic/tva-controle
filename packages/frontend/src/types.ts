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

export type ResultatCycle =
  | {
      statut: 'bloque';
      anomalies: AnomalieCycle[];
      comptesACategoriser: CompteACategoriser[];
      comptesSansTauxAssigne: CompteSansTauxAssigne[];
      comptesClientSansTaux: CompteClientSansTauxAssigne[];
      comptesAutoliquidationSuggeres: CompteACategoriser[];
    }
  | {
      statut: 'calcule';
      anomalies: AnomalieCycle[];
      resultat: ResultatCalculCycle;
      calculId: string;
      comptesACategoriser: CompteACategoriser[];
      comptesSansTauxAssigne: CompteSansTauxAssigne[];
      comptesClientSansTaux: CompteClientSansTauxAssigne[];
      comptesAutoliquidationSuggeres: CompteACategoriser[];
    };

// --- Calculs persistés (panneau "Calculs") ---

export type StatutCalcul = 'brouillon' | 'valide' | 'declare' | 'rejete';

export interface Calcul {
  id: string;
  periodeDebut: string;
  periodeFin: string;
  statut: StatutCalcul;
  tvaNette: number;
  sens: 'a_decaisser' | 'credit';
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
