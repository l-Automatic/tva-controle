import { describe, it, expect } from 'vitest';
import type { LigneEcritureAvecLettrage } from '@tva-controle/core';
import { analyserAutoliquidation } from '../src/autoliquidation.js';

// Six vraies paires 4454/445664, extraites telles quelles de la fixture
// réelle ledger_entry_lines_tva_page1.json (connector-pennylane) — pas de
// données inventées pour cette partie du test.
const PAIRES_REELLES: Array<{ ledgerEntryId: number; montant: number }> = [
  { ledgerEntryId: 22495307124736, montant: 734.75 }, // CABLES PRO VIR 14/01
  { ledgerEntryId: 22495307096064, montant: 429.65 }, // EEC CB 13/01
  { ledgerEntryId: 22495307071488, montant: 811.05 }, // ABR LCR 12/01
  { ledgerEntryId: 22495307005952, montant: 527.3 }, // EEC VIR 10/01
  { ledgerEntryId: 22495306977280, montant: 168.38 }, // ABR CHQ 09/01
  { ledgerEntryId: 22495307030528, montant: 582.27 }, // CABLES PRO CB 11/01
];

function ligne(overrides: Partial<LigneEcritureAvecLettrage>): LigneEcritureAvecLettrage {
  return {
    id: 1,
    compte: '4454',
    compteId: 1,
    libelle: null,
    debit: 0,
    credit: 0,
    date: '2025-01-01',
    ledgerEntryId: 1,
    lettrage: { estLettree: false, groupeIds: [] },
    ...overrides,
  };
}

function construireLignesReelles(): LigneEcritureAvecLettrage[] {
  const lignes: LigneEcritureAvecLettrage[] = [];
  for (const { ledgerEntryId, montant } of PAIRES_REELLES) {
    lignes.push(
      ligne({ compte: '4454', credit: montant, debit: 0, ledgerEntryId }),
      ligne({ compte: '445664', credit: 0, debit: montant, ledgerEntryId })
    );
  }
  return lignes;
}

describe('analyserAutoliquidation — six vraies paires du dossier sandbox', () => {
  it('propose 4454 comme due et 445664 comme déductible, avec 6 occurrences', () => {
    const propositions = analyserAutoliquidation(construireLignesReelles(), 3);

    expect(propositions).toHaveLength(2);
    const due = propositions.find((p) => p.cle === 'compte_tva_due_autoliquidee');
    const deductible = propositions.find((p) => p.cle === 'compte_tva_deductible_autoliquidee');

    expect(due).toMatchObject({ valeur: '4454', nbOccurrences: 6 });
    expect(deductible).toMatchObject({ valeur: '445664', nbOccurrences: 6 });
  });

  it('ne propose rien en dessous du seuil d’occurrences', () => {
    const troisPremieres = construireLignesReelles().slice(0, 4); // 2 paires seulement
    const propositions = analyserAutoliquidation(troisPremieres, 3);
    expect(propositions).toEqual([]);
  });

  it('ignore les pièces à plus de 2 lignes (pas une simple paire due/déductible)', () => {
    const lignes = [
      ligne({ compte: '4454', credit: 100, ledgerEntryId: 1 }),
      ligne({ compte: '445664', debit: 100, ledgerEntryId: 1 }),
      ligne({ compte: '445711', credit: 50, ledgerEntryId: 1 }), // 3e ligne -> exclue
    ];
    const propositions = analyserAutoliquidation(lignes, 1);
    expect(propositions).toEqual([]);
  });

  it('ignore une pièce dont les montants ne s’équilibrent pas', () => {
    const lignes = [
      ligne({ compte: '4454', credit: 100, ledgerEntryId: 1 }),
      ligne({ compte: '445664', debit: 90, ledgerEntryId: 1 }), // déséquilibré
    ];
    const propositions = analyserAutoliquidation(lignes, 1);
    expect(propositions).toEqual([]);
  });

  it('ignore une pièce où les deux lignes sont du même sens (pas des contreparties)', () => {
    const lignes = [
      ligne({ compte: '4454', credit: 100, ledgerEntryId: 1 }),
      ligne({ compte: '445664', credit: 100, ledgerEntryId: 1 }), // même sens
    ];
    const propositions = analyserAutoliquidation(lignes, 1);
    expect(propositions).toEqual([]);
  });
});
