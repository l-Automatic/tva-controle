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
  createdAt: string;
}

export type StatutProposition = 'candidate' | 'confirmed' | 'rejected';

export interface Proposition {
  id: string;
  dossierId: string;
  cle?: string;
  compteProduitOuCharge?: string;
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

export type ResultatCycle =
  | { statut: 'bloque'; anomalies: AnomalieCycle[] }
  | { statut: 'calcule'; anomalies: AnomalieCycle[]; resultat: ResultatCalculCycle; calculId: string };

// --- Calculs persistés (panneau "Calculs") ---

export type StatutCalcul = 'brouillon' | 'valide' | 'declare';

export interface Calcul {
  id: string;
  periodeDebut: string;
  periodeFin: string;
  statut: StatutCalcul;
  tvaNette: number;
  sens: 'a_decaisser' | 'credit';
}

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
