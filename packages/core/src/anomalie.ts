// Format de sortie du Module 4. Volontairement proche des colonnes de la
// table `anomalies` du schéma Postgres (001_schema_initial.sql), sans en
// dépendre directement — la persistance est une couche séparée.

export type GraviteAnomalie = 'bloquant' | 'signale' | 'info';

export interface Anomalie {
  type: string; // ex: 'taux_incoherent', 'autoliquidation_desequilibree'
  gravite: GraviteAnomalie;
  ledgerEntryId: number;
  compte: string;
  description: string;
  details?: Record<string, unknown>;
}
