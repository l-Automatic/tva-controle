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
// many requests" au clic du bouton) : lancées en parallèle (Promise.all),
// ces 4 fonctions déclenchent chacune plusieurs appels Pennylane en
// interne, potentiellement 15-20+ appels quasi simultanés au total — la
// limite documentée de 25 requêtes/5 secondes (cf. client.ts) peut être
// dépassée d'un coup, et si plusieurs appels retentent après le même délai
// (retry-after), ils se re-cognent les uns les autres jusqu'à épuiser
// leurs tentatives. Corrigé en séquentiel : chaque fonction termine tous
// ses appels avant que la suivante ne commence, ce qui laisse au
// mécanisme de nouvelle tentative existant (client.ts) le temps de
// vraiment absorber la charge, au prix d'un popup un peu plus long à
// charger — préférable à un échec visible pour l'utilisateur.
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
  const comptesTvaAConfirmer = await verifierComptesTvaAConfirmer(pool, params);
  const rapprochementsPaiementAchat = await preparerRapprochementsPaiementAchat(pool, params);
  const parcVehiculesNonRenseigne = await verifierParcVehicules(pool, params);

  return { categorisation, comptesTvaAConfirmer, rapprochementsPaiementAchat, parcVehiculesNonRenseigne };
}
