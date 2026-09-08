import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { verifierComptesACategoriser, type ResultatVerificationCategorisation } from './verifierComptesACategoriser.js';
import { verifierComptesTvaAConfirmer } from './verifierComptesTvaAConfirmer.js';
import { preparerRapprochementsPaiementAchat, type FactureARapprocher } from './preparerRapprochementsPaiementAchat.js';
import { verifierParcVehicules } from './verifierParcVehicules.js';
import type { Anomalie } from '@tva-controle/core';

// Agrège les 4 portes obligatoires avant cycle en un seul appel (10/08,
// demande de Rami — chantier UX popup unique). Jusqu'ici chacune avait sa
// propre route, ses propres appels réseau côté frontend, ses propres
// redirections — objectif : un seul popup à onglets, un seul appel pour
// peupler les 4 onglets d'un coup. Réutilise les 4 fonctions existantes
// telles quelles (jamais dupliqué de logique), en parallèle pour limiter
// le temps de chargement — chacune fait son propre aller-retour Pennylane,
// pas dédupliqué ici (risque et ampleur d'un chantier séparé).
export interface ParametresPortesObligatoires {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export interface EtatPortesObligatoires {
  categorisation: ResultatVerificationCategorisation;
  comptesTvaAConfirmer: Anomalie[];
  rapprochementsPaiementAchat: FactureARapprocher[];
  parcVehiculesNonRenseigne: boolean;
}

export async function chargerPortesObligatoires(
  pool: Pool,
  params: ParametresPortesObligatoires
): Promise<EtatPortesObligatoires> {
  const [categorisation, comptesTvaAConfirmer, rapprochementsPaiementAchat, parcVehiculesNonRenseigne] =
    await Promise.all([
      verifierComptesACategoriser(pool, params),
      verifierComptesTvaAConfirmer(pool, params),
      preparerRapprochementsPaiementAchat(pool, params),
      verifierParcVehicules(pool, params),
    ]);

  return { categorisation, comptesTvaAConfirmer, rapprochementsPaiementAchat, parcVehiculesNonRenseigne };
}
