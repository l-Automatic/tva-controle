import type { LigneEcritureAvecLettrage } from '@tva-controle/core';

export interface PropositionConvention {
  cle: string;
  valeur: string;
  confidenceNote: string;
  nbOccurrences: number;
}

// Limitation connue, assumée pour cette v1 : l'algorithme ne peut pas
// distinguer sémantiquement "vraie relation d'autoliquidation" d'une
// coïncidence (deux comptes 445xxx qui s'équilibrent sur une pièce à 2
// lignes pour une autre raison, ex: une OD de régularisation). D'où la
// sortie en `candidate` — la confirmation reste humaine (Module 6), jamais
// automatique, quel que soit le nombre d'occurrences.
export function analyserAutoliquidation(
  lignes: LigneEcritureAvecLettrage[],
  seuilOccurrences = 3
): PropositionConvention[] {
  const parPiece = new Map<number, LigneEcritureAvecLettrage[]>();
  for (const ligne of lignes) {
    const liste = parPiece.get(ligne.ledgerEntryId) ?? [];
    liste.push(ligne);
    parPiece.set(ligne.ledgerEntryId, liste);
  }

  // Compte les occurrences par paire ORIENTÉE (due, déductible) — une pièce
  // en sens inverse (ex: avoir/régularisation) compte dans l'autre sens,
  // et le sens dominant l'emporte naturellement au seuil.
  const tally = new Map<string, number>();

  for (const piece of parPiece.values()) {
    if (piece.length !== 2) continue;
    const [a, b] = piece as [LigneEcritureAvecLettrage, LigneEcritureAvecLettrage];
    if (a.compte === b.compte) continue;

    const montantA = a.credit - a.debit;
    const montantB = b.credit - b.debit;
    if (Math.abs(Math.abs(montantA) - Math.abs(montantB)) > 0.01) continue; // pas équilibré
    if (Math.sign(montantA) === Math.sign(montantB)) continue; // même sens = pas une contrepartie

    const [compteDue, compteDeductible] = montantA > 0 ? [a.compte, b.compte] : [b.compte, a.compte];
    const cle = `${compteDue}|${compteDeductible}`;
    tally.set(cle, (tally.get(cle) ?? 0) + 1);
  }

  const propositions: PropositionConvention[] = [];
  for (const [cle, count] of tally) {
    if (count < seuilOccurrences) continue;
    const [compteDue, compteDeductible] = cle.split('|') as [string, string];
    propositions.push(
      {
        cle: 'compte_tva_due_autoliquidee',
        valeur: compteDue,
        confidenceNote: `Détecté sur ${count} pièces où ${compteDue} (crédit) et ${compteDeductible} (débit) s'équilibrent systématiquement.`,
        nbOccurrences: count,
      },
      {
        cle: 'compte_tva_deductible_autoliquidee',
        valeur: compteDeductible,
        confidenceNote: `Détecté sur ${count} pièces, en contrepartie de ${compteDue}.`,
        nbOccurrences: count,
      }
    );
  }

  return propositions;
}
