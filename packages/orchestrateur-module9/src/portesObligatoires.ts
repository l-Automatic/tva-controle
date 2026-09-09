import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { verifierComptesACategoriser, type ResultatVerificationCategorisation } from './verifierComptesACategoriser.js';
import { verifierComptesTvaAConfirmer } from './verifierComptesTvaAConfirmer.js';
import { preparerRapprochementsPaiementAchat, type FactureARapprocher } from './preparerRapprochementsPaiementAchat.js';
import { verifierParcVehicules } from './verifierParcVehicules.js';
import type { Anomalie } from '@tva-controle/core';

// Agrège les 4 portes obligatoires avant cycle en un seul appel (10/08,
// demande de Rami — chantier UX popup unique). Jusqu'ici chacune avait sa
// propre route, ses propres appels réseau côté frontend, ses propres
// redirections — objectif : un seul popup à onglets, un seul appel pour
// peupler les 4 onglets d'un coup.
//
// Bug réel majeur corrigé (10/08, confirmé par Claude Code — ~100
// secondes constatées sur un vrai dossier en conditions réelles) : les 4
// fonctions faisaient CHACUNE leur propre aller-retour Pennylane (balance
// -> écritures) pour la MÊME période, entièrement redondant. Corrigé en
// récupérant une seule fois ici, partagé aux 4 fonctions via leur nouveau
// paramètre optionnel ecrituresPreChargees (cf. chacun de leurs fichiers).
// Seules verifierComptesACategoriser (suggestion IA) et
// preparerRapprochementsPaiementAchat (mouvements de paiement, précochage
// IA) gardent un vrai travail réseau propre après ce partage —
// verifierComptesTvaAConfirmer et verifierParcVehicules deviennent du pur
// calcul sur les écritures déjà en mémoire, plus aucun appel du tout.
//
// Les pauses explicites ajoutées plus tôt (contre un risque de rafale
// "too many requests") sont retirées : avec un seul aller-retour Pennylane
// partagé au lieu de quatre redondants, le nombre total d'appels chute
// largement sous la limite documentée (25 requêtes/5 secondes), sans
// compter le filet de sécurité déjà en place (maxRetries429 relevé à 8,
// cf. app.ts).
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
  const balance = await fetchTrialBalance(params.client, {
    dossierId: params.dossierId,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });
  const comptesTva = filterComptesParPrefixe(balance, ['445'])
    .filter((c) => c.debit !== 0 || c.credit !== 0)
    .map((c) => c.numeroCompte);
  const ecritures = await fetchEcrituresTvaCompletes(params.client, {
    comptesTva,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  const paramsAvecEcritures = { ...params, ecrituresPreChargees: ecritures };

  const categorisation = await verifierComptesACategoriser(pool, paramsAvecEcritures);
  const comptesTvaAConfirmer = await verifierComptesTvaAConfirmer(pool, paramsAvecEcritures);
  const rapprochementsPaiementAchat = await preparerRapprochementsPaiementAchat(pool, paramsAvecEcritures);
  const parcVehiculesNonRenseigne = await verifierParcVehicules(pool, paramsAvecEcritures);

  return { categorisation, comptesTvaAConfirmer, rapprochementsPaiementAchat, parcVehiculesNonRenseigne };
}
