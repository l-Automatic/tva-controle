import type { EcritureTvaComplete, Anomalie, ContexteDossier } from '@tva-controle/core';

// Règle : l'achat d'un véhicule de tourisme (en tant qu'immobilisation) est
// 0% déductible, contre 100% pour un véhicule utilitaire ou tout autre bien
// immobilisé. Distinct du contrôle carburant (determinerDeductibiliteCarburant),
// qui porte sur le CARBURANT acheté pour un véhicule déjà possédé, pas sur
// l'ACHAT du véhicule lui-même.
//
// Limite assumée, à ne pas dépasser sans y revenir : il n'existe aujourd'hui
// aucun lien fiable entre une ligne d'immobilisation confirmée
// (`parcVehicules`, notamment quand ajoutée manuellement — aucun
// `reference_piece` disponible dans ce cas) et l'écriture de TVA déductible
// (44562) précise qui lui correspond. Plutôt que de deviner ce lien et
// risquer d'exclure à tort la déductibilité d'un bien qui n'est pas le
// véhicule de tourisme, ce contrôle SIGNALE (jamais n'exclut
// automatiquement) chaque ligne 44562 dès que le dossier a au moins un
// véhicule de tourisme enregistré — décision humaine requise pour chaque
// ligne, comme pour la flotte mixte carburant.
export function verifierDeductibiliteVehiculeTourisme(
  ecritures: EcritureTvaComplete[],
  contexteDossier: ContexteDossier
): Anomalie[] {
  const aUnVehiculeTourisme = contexteDossier.parcVehicules.some((v) => v.type === 'vehicule_tourisme');
  if (!aUnVehiculeTourisme) return [];

  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId, libelle, debit } = ecriture.ligneTva;
    if (!compte.startsWith('44562')) continue;

    anomalies.push({
      type: 'immobilisation_vehicule_tourisme_a_verifier',
      gravite: 'signale',
      ledgerEntryId,
      compte,
      description:
        `TVA déductible sur immobilisation (44562) : le dossier a au moins un véhicule de tourisme ` +
        `enregistré (0% déductible sur son achat, contre 100% pour un utilitaire ou tout autre bien). ` +
        `À vérifier manuellement si cette écriture précise concerne ce véhicule.`,
      details: { libelle, montant: debit },
    });
  }

  return anomalies;
}
