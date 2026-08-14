import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

export interface ConfigExhaustiviteAutoliquidation {
  comptesChargeAutoliquidation: string[]; // convention confirmée, ex: ['604AUTOLIQ']
  compteTvaDueAutoliquidee: string; // ex: '4454'
  compteTvaDeductibleAutoliquidee: string; // ex: '445664'
}

// Demande de Rami (10/08) : vérifier que chaque achat de sous-traitance
// autoliquidée a bien SES DEUX écritures de contrepartie (TVA due +
// déductible), pas juste que 4454 et 445664 s'équilibrent ENTRE EUX quand
// ils existent (verifierAutoliquidationEquilibree, différent). Ici on
// détecte l'ABSENCE complète de la contrepartie — un oubli de saisie,
// fréquent en pratique.
//
// Nécessite une convention confirmée `comptes_charge_autoliquidation`
// (liste, comme comptes_vente_service etc.) — contrairement à
// coherenceAutoliquidation.ts, qui déduit le compte de charge concerné à
// la volée par co-occurrence sur chaque pièce (fonctionne pour vérifier
// une pièce qui EXISTE, structurellement incapable de repérer une pièce
// ABSENTE, puisque rien ne la relie au 445664 par définition — c'est
// justement ce qui manque).
//
// Méthode : compter les pièces distinctes touchant le(s) compte(s) de
// charge autoliquidation confirmés, comparer au nombre de pièces
// distinctes touchant 4454 et 445664 sur la même période. Un écart signale
// une contrepartie manquante — bloquant, comme pour un compte TVA non
// reconnu (même niveau de risque : un vrai oubli de conformité, pas une
// nuance d'appréciation).
export function verifierExhaustiviteAutoliquidation(
  ecritures: EcritureTvaComplete[],
  config: ConfigExhaustiviteAutoliquidation
): Anomalie[] {
  if (config.comptesChargeAutoliquidation.length === 0) return [];

  const piecesCharge = new Set<number>();
  const piecesDue = new Set<number>();
  const piecesDeductible = new Set<number>();

  for (const ecriture of ecritures) {
    const toucheCharge = ecriture.autresLignes.some((l) =>
      config.comptesChargeAutoliquidation.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (toucheCharge) piecesCharge.add(ecriture.ledgerEntryId);

    if (ecriture.ligneTva.compte === config.compteTvaDueAutoliquidee) {
      piecesDue.add(ecriture.ledgerEntryId);
    }
    if (ecriture.ligneTva.compte === config.compteTvaDeductibleAutoliquidee) {
      piecesDeductible.add(ecriture.ledgerEntryId);
    }
  }

  if (piecesCharge.size === 0) return [];

  const anomalies: Anomalie[] = [];

  if (piecesCharge.size !== piecesDue.size || piecesCharge.size !== piecesDeductible.size) {
    anomalies.push({
      type: 'autoliquidation_incomplete',
      gravite: 'bloquant',
      ledgerEntryId: [...piecesCharge][0]!,
      compte: config.comptesChargeAutoliquidation[0]!,
      description:
        `${piecesCharge.size} pièce(s) sur le(s) compte(s) de sous-traitance autoliquidée, mais ` +
        `${piecesDue.size} pièce(s) sur ${config.compteTvaDueAutoliquidee} (TVA due) et ` +
        `${piecesDeductible.size} pièce(s) sur ${config.compteTvaDeductibleAutoliquidee} (TVA déductible). ` +
        `Une ou plusieurs écritures d'autoliquidation semblent manquantes : à vérifier avant de poursuivre.`,
      details: {
        nbPiecesCharge: piecesCharge.size,
        nbPiecesDue: piecesDue.size,
        nbPiecesDeductible: piecesDeductible.size,
      },
    });
  }

  return anomalies;
}
