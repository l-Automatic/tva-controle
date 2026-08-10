import {
  BadgeCheck,
  Banknote,
  Building2,
  Car,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Fuel,
  HandCoins,
  HelpCircle,
  History,
  Layers,
  MessageSquareText,
  Percent,
  RefreshCw,
  Settings,
  Settings2,
  Shuffle,
  SlidersHorizontal,
  Tags,
  Undo2,
  UserPlus,
  UserX,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { TypeElementATraiter } from './types';

export const ICONE_ZONE: Record<'cycle' | 'configuration' | 'historique' | 'parametres', LucideIcon> = {
  cycle: RefreshCw,
  configuration: Settings2,
  historique: History,
  parametres: Settings,
};

export const ICONE_ACTION = {
  valider: Check,
  confirmer: Check,
  rejeter: X,
  resoudre: CheckCircle2,
  justifier: MessageSquareText,
  qualifier: Tags,
  parametres: SlidersHorizontal,
} as const satisfies Record<string, LucideIcon>;

// Une icône distincte par type d'anomalie (12 types, cf. CATALOGUE_ANOMALIES.md)
// pour les repérer d'un coup d'œil — repli générique pour un type inconnu.
export const ICONE_TYPE_ANOMALIE: Record<string, LucideIcon> = {
  compte_tva_non_reconnu: HelpCircle,
  encaissement_non_affecte: HandCoins,
  nature_operation_indeterminee: CircleAlert,
  nature_operation_mixte: Shuffle,
  ligne_tiers_introuvable: UserX,
  paiement_partiel_a_verifier: Layers,
  avoir_a_verifier: Undo2,
  parc_vehicules_non_renseigne: Car,
  flotte_mixte_carburant: Fuel,
  immobilisation_potentielle_non_passee: Building2,
  nouveau_tiers_a_verifier: UserPlus,
  encaissement_client_taux_applique: Percent,
};
export const ICONE_TYPE_ANOMALIE_DEFAUT: LucideIcon = CircleAlert;

export function iconeTypeAnomalie(type: string): LucideIcon {
  return ICONE_TYPE_ANOMALIE[type] ?? ICONE_TYPE_ANOMALIE_DEFAUT;
}

export const ICONE_STATUT: Record<string, LucideIcon> = {
  ouvert: Clock,
  candidate: Clock,
  brouillon: Clock,
  resolu: CircleCheck,
  confirmed: CircleCheck,
  valide: CircleCheck,
  justifie: BadgeCheck,
  declare: BadgeCheck,
  rejected: CircleX,
  rejete: CircleX,
};
export const ICONE_STATUT_DEFAUT: LucideIcon = Clock;

export function iconeStatut(statut: string): LucideIcon {
  return ICONE_STATUT[statut] ?? ICONE_STATUT_DEFAUT;
}

export const ICONE_ELEMENT_A_TRAITER: Record<TypeElementATraiter, LucideIcon> = {
  anomalie_bloquante: CircleAlert,
  convention_candidate: Tags,
  taux_candidate: Percent,
  taux_tiers_candidate: Percent,
  calcul_brouillon: Banknote,
};
