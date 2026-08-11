import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { analyserTauxHistorique, analyserTauxHistoriqueParTiers } from '../src/tauxHistorique.js';

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

  it('exclut les comptes déductibles (44566, 44562) — bug réel du 08/08, souvent mixtes donc pas de "taux habituel" à établir', () => {
    function ecritureDeductible(compte: string, montantTva: number, montantHT: number): EcritureTvaComplete {
      return {
        ledgerEntryId: 1,
        ligneTva: {
          id: 1,
          compte,
          compteId: 1,
          libelle: null,
          debit: montantTva,
          credit: 0,
          date: '2025-01-01',
          ledgerEntryId: 1,
          lettrage: { estLettree: true, groupeIds: [] },
        },
        lignesTiers: [],
        autresLignes: [{ id: 1, compte: '607', compteId: 1, libelle: null, debit: montantHT, credit: 0 }],
      };
    }
    const ecritures = [
      ecritureDeductible('44566', 200, 1000),
      ecritureDeductible('44566', 200, 1000),
      ecritureDeductible('44566', 200, 1000),
      ecritureDeductible('44562', 200, 1000),
      ecritureDeductible('44562', 200, 1000),
      ecritureDeductible('44562', 200, 1000),
    ];

    expect(analyserTauxHistorique(ecritures, 3)).toEqual([]);
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

function ecritureAvecTiers(
  ledgerEntryId: number,
  montantTva: number,
  montantHT: number,
  numeroCompteTiers: string,
  estLettree = true
): EcritureTvaComplete {
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
    lignesTiers: [
      {
        compte: numeroCompteTiers,
        compteId: 1,
        libelleCompte: null,
        debit: montantTva + montantHT,
        credit: 0,
        lettrage: { estLettree, groupeIds: estLettree ? [1, 2] : [] },
      },
    ],
    autresLignes: [{ id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: montantHT }],
  };
}

describe('analyserTauxHistoriqueParTiers', () => {
  it('propose 20% pour un compte client dont l’historique lettré est dominant à 20%', () => {
    const ecritures = [
      ecritureAvecTiers(1, 200, 1000, '411ROUSSEAU'),
      ecritureAvecTiers(2, 400, 2000, '411ROUSSEAU'),
      ecritureAvecTiers(3, 600, 3000, '411ROUSSEAU'),
      ecritureAvecTiers(4, 100, 1000, '411ROUSSEAU'), // 10%, minoritaire
    ];

    const propositions = analyserTauxHistoriqueParTiers(ecritures, 3);
    expect(propositions).toEqual([{ numeroCompteTiers: '411ROUSSEAU', tauxHabituel: 20, nbOccurrences: 3 }]);
  });

  it('ignore les lignes tiers non lettrées — on ne peut pas apprendre d’une facture pas encore payée', () => {
    const ecritures = [
      ecritureAvecTiers(1, 200, 1000, '411X', true),
      ecritureAvecTiers(2, 200, 1000, '411X', true),
      ecritureAvecTiers(3, 200, 1000, '411X', false), // non lettrée, ne doit pas compter
    ];

    expect(analyserTauxHistoriqueParTiers(ecritures, 3)).toEqual([]);
  });

  it('distingue deux comptes clients différents', () => {
    const ecritures = [
      ecritureAvecTiers(1, 200, 1000, '411A'),
      ecritureAvecTiers(2, 200, 1000, '411A'),
      ecritureAvecTiers(3, 200, 1000, '411A'),
      ecritureAvecTiers(4, 100, 1000, '411B'),
      ecritureAvecTiers(5, 100, 1000, '411B'),
      ecritureAvecTiers(6, 100, 1000, '411B'),
    ];

    const propositions = analyserTauxHistoriqueParTiers(ecritures, 3);
    expect(propositions.sort((a, b) => a.numeroCompteTiers.localeCompare(b.numeroCompteTiers))).toEqual([
      { numeroCompteTiers: '411A', tauxHabituel: 20, nbOccurrences: 3 },
      { numeroCompteTiers: '411B', tauxHabituel: 10, nbOccurrences: 3 },
    ]);
  });

  it('ignore une écriture sans ligne tiers du tout', () => {
    const sansTiers: EcritureTvaComplete = {
      ledgerEntryId: 1,
      ligneTva: {
        id: 1,
        compte: '445711',
        compteId: 1,
        libelle: null,
        debit: 0,
        credit: 200,
        date: '2025-01-01',
        ledgerEntryId: 1,
        lettrage: { estLettree: true, groupeIds: [] },
      },
      lignesTiers: [],
      autresLignes: [{ id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 }],
    };

    expect(analyserTauxHistoriqueParTiers([sansTiers], 1)).toEqual([]);
  });
});
