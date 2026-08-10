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

// Les 4 conventions de comptes configurables via l'écran dédié — chacune
// prend une liste de numéros de compte (`valeur` en JSONB côté API).
// Distinctes des conventions à valeur unique (ex: compte_tva_due_autoliquidee),
// gérées par le panneau générique "Conventions".
export const CLES_CONVENTIONS_COMPTES = [
  'comptes_vente_service',
  'comptes_charge_service',
  'comptes_equipement',
  'comptes_carburant',
] as const;
export type CleConventionCompte = (typeof CLES_CONVENTIONS_COMPTES)[number];

export const LIBELLE_CLE_CONVENTION: Record<CleConventionCompte, string> = {
  comptes_vente_service: 'Comptes de vente de service',
  comptes_charge_service: 'Comptes de charge de service (sous-traitance)',
  comptes_equipement: 'Comptes d’équipement (immobilisations)',
  comptes_carburant: 'Comptes de carburant',
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

// Comptes produit/charge mouvementés sur la période mais absents des 4
// conventions de comptes — popup de catégorisation (brief v2). Sans
// présélection IA pour l'instant (chantier séparé, pas construit).
export interface CompteACategoriser {
  compte: string;
  exemplesLibelle: string[];
}

export type ResultatCycle =
  | { statut: 'bloque'; anomalies: AnomalieCycle[]; comptesACategoriser: CompteACategoriser[] }
  | {
      statut: 'calcule';
      anomalies: AnomalieCycle[];
      resultat: ResultatCalculCycle;
      calculId: string;
      comptesACategoriser: CompteACategoriser[];
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
  '0': '0 %',
  '2.1': '2,1 %',
  '5.5': '5,5 %',
  '10': '10 %',
  '20': '20 %',
  autoliquide_intracom: 'Autoliquidé — intracommunautaire',
  autoliquide_20: 'Autoliquidé — 20 %',
  autoliquide_10: 'Autoliquidé — 10 %',
  'autoliquide_5.5': 'Autoliquidé — 5,5 %',
};

export interface TauxAssigneEntry {
  compte: string;
  tauxAssigne: TauxAssigne;
  updatedAt: string;
}

// --- Dégradés du volet latéral (brief v2) — palette fournie, stockée
// comme paramètre dossier (`theme_degrade`), jamais cabinet. ---

export const CLE_THEME_DEGRADE = 'theme_degrade';

export const DEGRADES_SIDEBAR = [
  'linear-gradient(135deg, #FF6CAB, #7366FF)',
  'linear-gradient(135deg, #B65EBA, #2E8DE1)',
  'linear-gradient(135deg, #64E8DE, #8A64EB)',
  'linear-gradient(135deg, #7BF2E9, #B65EBA)',
  'linear-gradient(135deg, #FF9482, #7D77FF)',
  'linear-gradient(135deg, #FFCF1B, #FF881B)',
  'linear-gradient(135deg, #FFA62E, #EA4D2C)',
  'linear-gradient(135deg, #00FFED, #00B8BA)',
  'linear-gradient(135deg, #6EE2F5, #6454F0)',
  'linear-gradient(135deg, #3499FF, #3A3985)',
  'linear-gradient(135deg, #FF9897, #F650A0)',
  'linear-gradient(135deg, #FFCDA5, #EE4D5F)',
  'linear-gradient(135deg, #FF5B94, #8441A4)',
  'linear-gradient(135deg, #F869D5, #5650DE)',
  'linear-gradient(135deg, #F00B51, #7366FF)',
] as const;
export const DEGRADE_PAR_DEFAUT: string = DEGRADES_SIDEBAR[9]; // bleu sobre, cohérent avec l'accent existant

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
