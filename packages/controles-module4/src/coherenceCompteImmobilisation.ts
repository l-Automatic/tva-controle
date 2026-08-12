import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

export interface ConfigCoherenceCompteImmobilisation {
  comptesImmobilisation: string[]; // ex: ['218', '215'] — 5e catégorie de convention
}

// Demande de Rami (09/08, fin de session) : nouvelle catégorie de
// convention `comptes_immobilisation`, distincte de `comptes_equipement`
// (qui sert au seuil "petit équipement à surveiller", 6063 typiquement).
// Ici on catégorise les VRAIS comptes d'immobilisation confirmés (218X,
// 215X...) pour vérifier une erreur de saisie fréquente et concrète :
// la TVA déductible d'une immobilisation doit être sur le compte 44562,
// jamais 44566 (compte "autres biens et services") — si un comptable se
// trompe et passe du 44566 sur une pièce qui touche un compte
// d'immobilisation confirmé, c'est une vraie erreur à corriger, pas une
// nuance d'appréciation. D'où : anomalie BLOQUANTE (contrairement à la
// plupart des contrôles de ce module), pas juste signalée.
export function verifierCoherenceCompteImmobilisation(
  ecritures: EcritureTvaComplete[],
  config: ConfigCoherenceCompteImmobilisation
): Anomalie[] {
  if (config.comptesImmobilisation.length === 0) return [];

  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    const toucheUnCompteImmo = ecriture.autresLignes.some((l) =>
      config.comptesImmobilisation.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (!toucheUnCompteImmo) continue;

    if (ecriture.ligneTva.compte.startsWith('44566')) {
      anomalies.push({
        type: 'immobilisation_sur_compte_tva_incorrect',
        gravite: 'bloquant',
        ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
        compte: ecriture.ligneTva.compte,
        description:
          `Cette pièce touche un compte d'immobilisation confirmé mais sa TVA déductible est passée en 44566 ` +
          `(autres biens et services) au lieu de 44562 (immobilisations) : erreur de saisie à corriger avant ` +
          `de poursuivre le calcul.`,
        details: { libelle: ecriture.ligneTva.libelle, compteTvaTrouve: ecriture.ligneTva.compte },
      });
    }
  }

  return anomalies;
}
