import { describe, it, expect } from 'vitest';
import type { LigneGroupeLettrage } from '@tva-controle/core';
import { calculerProrataEncaissement } from '../src/calculerProrataEncaissement.js';

function ligne(id: number, debit: number, credit: number): LigneGroupeLettrage {
  return { id, compte: '411ROUSSEAU', compteId: 1, libelle: null, debit, credit, date: '2025-01-01' };
}

describe('calculerProrataEncaissement', () => {
  it('60% encaissé sur une facture de 1000 donne un prorata de 0.6', () => {
    const groupe = [ligne(1, 0, 1000), ligne(2, 600, 0)];
    expect(calculerProrataEncaissement(groupe)).toBeCloseTo(0.6);
  });

  it('facture entièrement payée donne un prorata de 1', () => {
    const groupe = [ligne(1, 0, 1000), ligne(2, 1000, 0)];
    expect(calculerProrataEncaissement(groupe)).toBe(1);
  });

  it('plusieurs factures et un paiement partiel réparti', () => {
    const groupe = [ligne(1, 0, 500), ligne(2, 0, 500), ligne(3, 600, 0)];
    expect(calculerProrataEncaissement(groupe)).toBeCloseTo(0.6);
  });

  it('plafonne à 1 même en cas de sur-paiement apparent', () => {
    const groupe = [ligne(1, 0, 1000), ligne(2, 1200, 0)];
    expect(calculerProrataEncaissement(groupe)).toBe(1);
  });

  it('retourne 1 (pas d’exclusion par prudence) si le total facturé est nul', () => {
    expect(calculerProrataEncaissement([])).toBe(1);
  });
});
