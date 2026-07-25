import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// Vérifie, pour chaque pièce, que la TVA due autoliquidée (compte "due") a
// bien sa contrepartie déductible (compte "déductible") avec un montant
// identique — et inversement. Les comptes par défaut correspondent au
// dossier sandbox observé ; c'est une convention par dossier à terme
// (Module 2 bis / conventions_dossier), pas une constante universelle —
// d'où les paramètres plutôt que des valeurs codées en dur dans la logique.
export function verifierAutoliquidationEquilibree(
  ecritures: EcritureTvaComplete[],
  compteDue = '4454',
  compteDeductible = '445664',
  toleranceMontant = 0.01
): Anomalie[] {
  const anomalies: Anomalie[] = [];

  const parPiece = new Map<number, EcritureTvaComplete[]>();
  for (const ecriture of ecritures) {
    if (ecriture.ligneTva.compte !== compteDue && ecriture.ligneTva.compte !== compteDeductible) {
      continue;
    }
    const liste = parPiece.get(ecriture.ledgerEntryId) ?? [];
    liste.push(ecriture);
    parPiece.set(ecriture.ledgerEntryId, liste);
  }

  for (const [ledgerEntryId, lignes] of parPiece) {
    const ligneDue = lignes.find((l) => l.ligneTva.compte === compteDue);
    const ligneDeductible = lignes.find((l) => l.ligneTva.compte === compteDeductible);

    if (ligneDue && !ligneDeductible) {
      anomalies.push({
        type: 'autoliquidation_desequilibree',
        gravite: 'bloquant',
        ledgerEntryId,
        compte: compteDue,
        description: `TVA due autoliquidée (${compteDue}) sans contrepartie déductible (${compteDeductible}) sur cette pièce — écriture d'autoliquidation probablement incomplète.`,
        details: { montantDue: montant(ligneDue) },
      });
      continue;
    }

    if (ligneDeductible && !ligneDue) {
      anomalies.push({
        type: 'autoliquidation_desequilibree',
        gravite: 'bloquant',
        ledgerEntryId,
        compte: compteDeductible,
        description: `TVA déductible autoliquidée (${compteDeductible}) sans contrepartie due (${compteDue}) sur cette pièce.`,
        details: { montantDeductible: montant(ligneDeductible) },
      });
      continue;
    }

    if (ligneDue && ligneDeductible) {
      const montantDue = montant(ligneDue);
      const montantDeductible = montant(ligneDeductible);
      if (Math.abs(montantDue - montantDeductible) > toleranceMontant) {
        anomalies.push({
          type: 'autoliquidation_desequilibree',
          gravite: 'bloquant',
          ledgerEntryId,
          compte: `${compteDue}/${compteDeductible}`,
          description: `Montants d'autoliquidation différents entre ${compteDue} (${montantDue}) et ${compteDeductible} (${montantDeductible}) sur la même pièce.`,
          details: { montantDue, montantDeductible },
        });
      }
    }
  }

  return anomalies;
}

function montant(ecriture: EcritureTvaComplete): number {
  return Math.abs(ecriture.ligneTva.credit - ecriture.ligneTva.debit);
}
