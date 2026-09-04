import type { EcritureTvaComplete, Anomalie, ContexteDossier } from '@tva-controle/core';
import { TAUX_NOMINAL_PAR_DEFAUT } from './types.js';
import { verifierCoherenceTauxCollecte } from './coherenceTaux.js';
import { verifierAutoliquidationEquilibree } from './autoliquidation.js';
import { verifierAvoirs } from './avoirs.js';
export { verifierAvoirs } from './avoirs.js';
import { detecterComptesTvaNonReconnus } from './comptesNonReconnus.js';
export {
  determinerExigibiliteTva,
  type ConfigExigibiliteTva,
  type StatutExigibilite,
  type NatureOperation,
  type ProrataApplique,
} from './exigibilite.js';
export {
  detecterImmobilisationManquee,
  type ConfigImmobilisationManquee,
} from './immobilisation.js';
export {
  determinerDeductibiliteCarburant,
  type ConfigCarburantVehicule,
  type StatutCarburant,
} from './carburant.js';
export { detecterComptesTvaNonReconnus, type ConfigComptesTva } from './comptesNonReconnus.js';
export { detecterEncaissementsNonAffectes } from './encaissementNonAffecte.js';
export { verifierNouveauxTiers, type StatutTiers } from './tiersReference.js';
export {
  detecterEncaissementsClientAAffecter,
  type RegularisationClientAAppliquer,
  type RegimeTvaEncaissement,
} from './encaissementClientNonAffecte.js';
export {
  identifierComptesACategoriser,
  identifierComptesServiceSansSousCategorieAutoliquidation,
  type ComptesConnus,
  type CompteACategoriser,
} from './comptesACategoriser.js';
export {
  identifierComptesSansTauxAssigne,
  identifierComptesClientSansTaux,
  type CompteSansTauxAssigne,
  type CompteClientSansTauxAssigne,
} from './tauxSuggestions.js';
export {
  identifierCandidatsJugementVehiculeTourisme,
  type CandidatJugementVehiculeTourisme,
} from './candidatsVehiculeTourisme.js';
export {
  verifierCoherenceTauxAutoliquidation,
  type ConfigCoherenceAutoliquidation,
} from './coherenceAutoliquidation.js';
export {
  verifierCoherenceCompteImmobilisation,
  type ConfigCoherenceCompteImmobilisation,
} from './coherenceCompteImmobilisation.js';
export {
  verifierExhaustiviteAutoliquidation,
  type ConfigExhaustiviteAutoliquidation,
} from './exhaustiviteAutoliquidation.js';
export { verifierCoherenceTvaHotel } from './coherenceHotel.js';
export {
  chercherDansReferentiel,
  REFERENTIEL_COMPTES_CHARGE,
  type EntreeReferentielCompte,
} from './referentielComptesCharge.js';
export { identifierCandidatsJugementHotel, type CandidatJugementHotel } from './candidatsHotel.js';
export {
  extraireNumeroSequence,
  detecterTrousNumerotation,
  type MotifNumerotationConfirme,
} from './detecterTrousNumerotation.js';
export { calculerProrataEncaissement } from './calculerProrataEncaissement.js';
export {
  identifierFacturesCandidatesAcompte,
  type FactureCandidateAcompte,
} from './facturesCandidatesAcompte.js';
export { verifierAbsenceTvaLivraisonIntracom } from './livraisonIntracom.js';

export interface ConfigPreControles {
  tauxNominalParCompte?: Record<string, number>;
  compteAutoliquidationDue?: string;
  compteAutoliquidationDeductible?: string;
  // TVA intracom (10/08) — deuxième paire d'autoliquidation, vérifiée en
  // plus de celle du BTP, jamais à sa place.
  compteAutoliquidationDueIntracom?: string;
  compteAutoliquidationDeductibleIntracom?: string;
  // Mémoire de dossier (taux_historique, conventions...) — quand fournie,
  // prend le pas sur tauxNominalParCompte pour le contrôle de cohérence des
  // taux. Optionnel : un dossier tout juste onboardé n'en a pas encore.
  contexteDossier?: ContexteDossier;
}

// Exécute l'ensemble des pré-contrôles déterministes disponibles à ce stade
// du projet (v1) sur une liste d'écritures TVA déjà composées par le
// connecteur. Fonction pure : aucun accès réseau, aucun accès base de
// données — la persistance des anomalies produites est un problème séparé
// (Module 2 bis), volontairement pas traité ici.
export function executerPreControles(
  ecritures: EcritureTvaComplete[],
  config: ConfigPreControles = {}
): Anomalie[] {
  return [
    ...verifierCoherenceTauxCollecte(
      ecritures,
      config.tauxNominalParCompte ?? TAUX_NOMINAL_PAR_DEFAUT,
      0.5,
      config.contexteDossier
    ),
    ...verifierAutoliquidationEquilibree(
      ecritures,
      config.compteAutoliquidationDue,
      config.compteAutoliquidationDeductible
    ),
    // TVA intracom : vérification séparée, seulement si les deux comptes
    // sont confirmés (pas de valeur par défaut sensée ici, contrairement
    // au BTP — passer undefined ferait tourner verifierAutoliquidationEquilibree
    // sur les valeurs par défaut BTP par erreur).
    ...(config.compteAutoliquidationDueIntracom && config.compteAutoliquidationDeductibleIntracom
      ? verifierAutoliquidationEquilibree(
          ecritures,
          config.compteAutoliquidationDueIntracom,
          config.compteAutoliquidationDeductibleIntracom
        )
      : []),
    ...verifierAvoirs(ecritures),
    ...detecterComptesTvaNonReconnus(ecritures, {
      ...(config.compteAutoliquidationDue !== undefined
        ? { compteAutoliquidationDue: config.compteAutoliquidationDue }
        : {}),
      ...(config.compteAutoliquidationDeductible !== undefined
        ? { compteAutoliquidationDeductible: config.compteAutoliquidationDeductible }
        : {}),
      ...(config.compteAutoliquidationDueIntracom !== undefined
        ? { compteAutoliquidationDueIntracom: config.compteAutoliquidationDueIntracom }
        : {}),
      ...(config.compteAutoliquidationDeductibleIntracom !== undefined
        ? { compteAutoliquidationDeductibleIntracom: config.compteAutoliquidationDeductibleIntracom }
        : {}),
    }),
  ];
}
