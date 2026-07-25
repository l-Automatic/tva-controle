// Format pivot commun consommé par le reste du système (Modules 4, 5, 7...).
// Aucun de ces types ne doit refléter une particularité de l'API Pennylane —
// c'est le rôle du connecteur de faire cette traduction, pas l'inverse.
// Quand un deuxième logiciel (Inqom, ACD, ...) sera branché, son connecteur
// devra produire exactement ces mêmes types, sans changement en aval.

export interface CompteSolde {
  numeroCompte: string;
  numeroCompteFormate: string;
  libelle: string;
  debit: number;
  credit: number;
}

export interface BalanceComptable {
  dossierId: string;
  periodeDebut: string; // format YYYY-MM-DD
  periodeFin: string;
  comptes: CompteSolde[];
}

// --- Écritures détaillées (comptes TVA + contrepartie tiers) ---
// Contrat validé contre de vraies réponses de l'API Company v2 (comptes,
// lignes générales, lignes de pièce, lettrage) — pas des données inventées.

export interface Lettrage {
  estLettree: boolean;
  // Tous les id de ligne du groupe de lettrage, y compris cette ligne elle-même.
  // Vide si non lettrée. Distinguer "lettré" de "partiellement lettré" exige de
  // comparer les montants de tout le groupe — ce n'est PAS fait ici : c'est un
  // calcul métier (Module 4), pas une traduction de format par le connecteur.
  groupeIds: number[];
}

export interface LigneEcriture {
  id: number;
  compte: string;
  compteId: number;
  libelle: string | null;
  debit: number;
  credit: number;
  date: string; // YYYY-MM-DD
  ledgerEntryId: number; // référence de pièce — regroupe les lignes d'une même écriture
}

export interface LigneEcritureAvecLettrage extends LigneEcriture {
  lettrage: Lettrage;
}

export interface LigneTiersAvecContexte {
  compte: string;
  compteId: number;
  libelleCompte: string | null; // ex: "CLIENT ROUSSEAU" — nom réel, pas le texte libre de la ligne
  debit: number;
  credit: number;
  lettrage: Lettrage;
}

export interface EcritureTvaComplete {
  ligneTva: LigneEcritureAvecLettrage;
  ledgerEntryId: number;
  // Un tableau, pas un objet unique : une pièce peut en théorie contenir
  // plusieurs lignes tiers lettrables (cas rare mais pas exclu). On ne force
  // pas une hypothèse "une seule contrepartie" qui casserait silencieusement.
  lignesTiers: LigneTiersAvecContexte[];
  // Les lignes restantes de la pièce (ni TVA, ni tiers lettrable) — typiquement
  // le compte de charge (604/611...) ou de produit (706/707...). Nécessaire
  // pour le contrôle bien/service du Module 4, qui se fait sur ce compte, pas
  // sur le nom du tiers. Ne PAS jeter cette info comme le faisait la première
  // version de l'orchestrateur.
  autresLignes: LigneEcritureBrute[];
}

export interface LigneEcritureBrute {
  id: number;
  compte: string;
  compteId: number;
  libelle: string | null;
  debit: number;
  credit: number;
}

