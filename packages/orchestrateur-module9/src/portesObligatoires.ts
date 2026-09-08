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
// telles quelles (jamais dupliqué de logique).
//
// Bug réel corrigé (10/08, trouvé par Rami en conditions réelles — "too
// many requests" au clic du bouton, persistant même après le passage en
// séquentiel ci-dessous) : chaque fonction déclenche plusieurs appels
// Pennylane en interne (potentiellement 15-20+ au total), et une exécution
// séquentielle SANS pause entre les fonctions reste une vraie rafale si
// chaque appel individuel est rapide — la limite documentée de 25
// requêtes/5 secondes (cf. client.ts, firmClient.ts) peut toujours être
// dépassée. Deux corrections combinées : maxRetries429 relevé de 3 à 8
// côté client (cf. app.ts, resoudreClientPennylane), ET une vraie pause
// explicite ici entre chaque fonction, pour réduire la sévérité de la
// rafale plutôt que de compter uniquement sur les nouvelles tentatives.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const categorisation = await verifierComptesACategoriser(pool, params);
  await sleep(1200);
  const comptesTvaAConfirmer = await verifierComptesTvaAConfirmer(pool, params);
  await sleep(1200);
  const rapprochementsPaiementAchat = await preparerRapprochementsPaiementAchat(pool, params);
  await sleep(1200);
  const parcVehiculesNonRenseigne = await verifierParcVehicules(pool, params);

  return { categorisation, comptesTvaAConfirmer, rapprochementsPaiementAchat, parcVehiculesNonRenseigne };
}
