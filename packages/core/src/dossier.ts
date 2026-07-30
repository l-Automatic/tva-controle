// Miroir applicatif des tables conventions_dossier / taux_historique du
// schéma Postgres (001_schema_initial.sql). Volontairement en lecture seule
// ici : Module 4 consomme ces données, ne les écrit jamais directement — les
// mises à jour passent par le mécanisme candidate/confirmed (Module 5/6).

export interface TauxHistorique {
  compteOuTiers: string; // compte_produit_ou_charge ou identifiant tiers
  tauxHabituel: number; // ex: 20, 10, 5.5, 2.1
  nbOccurrences: number;
}

export interface ConventionDossier {
  cle: string;
  valeur: unknown;
  statut: 'candidate' | 'confirmed' | 'rejected';
}

export type TypeVehicule = 'vehicule_tourisme' | 'vehicule_utilitaire' | 'autre';

export interface Vehicule {
  type: TypeVehicule;
}

// Vue en mémoire de la mémoire de dossier pertinente pour un contrôle donné —
// évite à chaque fonction de contrôle de dépendre d'un client SQL. Les
// fonctions de Module 4 restent des fonctions pures : (écriture, contexte
// dossier) -> anomalies. Le câblage vers Postgres est une couche séparée.
export interface ContexteDossier {
  tauxHistorique: TauxHistorique[];
  conventions: ConventionDossier[];
  parcVehicules: Vehicule[]; // miroir de la table immobilisations, filtré véhicules
  // Miroir de tiers_reference.numero_compte_tiers pour ce dossier — tiers
  // déjà rencontrés lors d'un cycle précédent, quel que soit leur niveau de
  // confiance actuel. Absence d'un compte ici (ou champ non fourni du tout,
  // ex: dossier tout juste onboardé) = jamais vu = nouveau. Optionnel,
  // comme parcVehicules l'est implicitement via le même raisonnement.
  tiersConnus?: string[];
}

export function tauxHabituelPour(
  contexte: ContexteDossier,
  compteOuTiers: string
): number | null {
  const trouve = contexte.tauxHistorique.find((t) => t.compteOuTiers === compteOuTiers);
  return trouve ? trouve.tauxHabituel : null;
}
