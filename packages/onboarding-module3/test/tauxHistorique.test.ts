import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { analyserTauxHistorique } from '../src/tauxHistorique.js';

// Un seul exemple réel disponible (ROUSSEAU, 711.03/3555.14 = 20%) pour cette
// analyse — les autres occurrences ci-dessous sont construites (montants
// différents, même taux 20%) pour atteindre le seuil et prouver le
// comportement de dominance, pas des données API.
function ecriture(ledgerEntryId: number, montantTva: number, montantHT: number): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: '445711',
      compteId: 1,
      libelle: null,
      debit: 0,
      credit: montantTva,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: true, groupeIds: [] },
    },
    lignesTiers: [],
    autresLignes: [{ id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: montantHT }],
  };
}

describe('analyserTauxHistorique', () => {
  it('propose 20% pour 445711, dominant sur l’historique (dont le cas réel ROUSSEAU)', () => {
    const ecritures = [
      ecriture(22495307276288, 711.03, 3555.14), // cas réel ROUSSEAU, exactement 20%
      ecriture(2, 200, 1000), // 20%
      ecriture(3, 400, 2000), // 20%
      ecriture(4, 100, 1000), // 10% — minoritaire, ne doit pas l'emporter
    ];

    const propositions = analyserTauxHistorique(ecritures, 3);
    expect(propositions).toEqual([{ compteOuTiers: '445711', tauxHabituel: 20, nbOccurrences: 3 }]);
  });

  it('ne propose rien en dessous du seuil', () => {
    const ecritures = [ecriture(1, 200, 1000), ecriture(2, 400, 2000)]; // seulement 2 occurrences
    expect(analyserTauxHistorique(ecritures, 3)).toEqual([]);
  });

  it('ignore les écritures à base HT nulle', () => {
    const e = ecriture(1, 200, 0);
    expect(analyserTauxHistorique([e], 1)).toEqual([]);
  });

  it('normalise un taux implicite proche d’un taux officiel (arrondi de saisie)', () => {
    const ecritures = [
      ecriture(1, 199.5, 1000), // 19.95% -> doit être normalisé à 20%
      ecriture(2, 200, 1000),
      ecriture(3, 200.5, 1000),
    ];
    const propositions = analyserTauxHistorique(ecritures, 3);
    expect(propositions).toEqual([{ compteOuTiers: '445711', tauxHabituel: 20, nbOccurrences: 3 }]);
  });

  it('garde un taux non officiel tel quel s’il domine (à examiner manuellement)', () => {
    const ecritures = [ecriture(1, 80, 1000), ecriture(2, 80, 1000), ecriture(3, 80, 1000)]; // 8%, pas un taux national
    const propositions = analyserTauxHistorique(ecritures, 3);
    expect(propositions).toEqual([{ compteOuTiers: '445711', tauxHabituel: 8, nbOccurrences: 3 }]);
  });
});
