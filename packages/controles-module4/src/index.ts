import type { EcritureTvaComplete, Anomalie, ContexteDossier } from '@tva-controle/core';
import { TAUX_NOMINAL_PAR_DEFAUT } from './types.js';
import { verifierCoherenceTauxCollecte } from './coherenceTaux.js';
import { verifierAutoliquidationEquilibree } from './autoliquidation.js';
import { verifierAvoirsCollecte } from './avoirs.js';
import { detecterComptesTvaNonReconnus } from './comptesNonReconnus.js';
export {
  determinerExigibiliteTva,
  type ConfigExigibiliteTva,
  type StatutExigibilite,
  type NatureOperation,
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
} from './encaissementClientNonAffecte.js';

export interface ConfigPreControles {
  tauxNominalParCompte?: Record<string, number>;
  compteAutoliquidationDue?: string;
  compteAutoliquidationDeductible?: string;
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
    ...verifierAvoirsCollecte(ecritures),
    ...detecterComptesTvaNonReconnus(ecritures, {
      ...(config.compteAutoliquidationDue !== undefined
        ? { compteAutoliquidationDue: config.compteAutoliquidationDue }
        : {}),
      ...(config.compteAutoliquidationDeductible !== undefined
        ? { compteAutoliquidationDeductible: config.compteAutoliquidationDeductible }
        : {}),
    }),
  ];
}
