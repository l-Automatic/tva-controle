import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierAvoirs } from '../src/avoirs.js';

function ecriture(overrides: Partial<EcritureTvaComplete['ligneTva']> = {}): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: '44571',
      compteId: 1,
      libelle: 'AVOIR CLIENT DUPONT',
      debit: 0,
      credit: 0,
      date: '2025-01-15',
      ledgerEntryId: 1,
      lettrage: { estLettree: false, groupeIds: [] },
      ...overrides,
    },
    autresLignes: [],
    lignesTiers: [],
  };
}

describe('verifierAvoirs', () => {
  it('signale un débit sur un compte de TVA collectée', () => {
    const e = ecriture({ compte: '44571', debit: 120, credit: 0 });
    const anomalies = verifierAvoirs([e]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('avoir_a_verifier');
    expect(anomalies[0]?.gravite).toBe('signale');
    expect(anomalies[0]?.details).toMatchObject({ sens: 'collecte', debit: 120 });
  });

  it('signale un crédit sur un compte de TVA déductible (10/08, étendu aux achats — confirmé par Rami)', () => {
    const e = ecriture({ compte: '44566', debit: 0, credit: 80 });
    const anomalies = verifierAvoirs([e]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.details).toMatchObject({ sens: 'deductible', credit: 80 });
  });

  it('signale aussi sur le second compte déductible (44562)', () => {
    const e = ecriture({ compte: '44562', debit: 0, credit: 50 });
    const anomalies = verifierAvoirs([e]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.details).toMatchObject({ sens: 'deductible' });
  });

  it('ne signale rien pour un crédit normal sur un compte collecté (le sens attendu)', () => {
    const e = ecriture({ compte: '44571', debit: 0, credit: 200 });
    expect(verifierAvoirs([e])).toEqual([]);
  });

  it('ne signale rien pour un débit normal sur un compte déductible (le sens attendu)', () => {
    const e = ecriture({ compte: '44566', debit: 150, credit: 0 });
    expect(verifierAvoirs([e])).toEqual([]);
  });

  it('ne signale rien pour un compte hors périmètre (ni collecte ni déductible)', () => {
    const e = ecriture({ compte: '4454', debit: 100, credit: 0 });
    expect(verifierAvoirs([e])).toEqual([]);
  });

  it('accepte des préfixes personnalisés pour les deux sens', () => {
    const e = ecriture({ compte: '44575', debit: 30, credit: 0 });
    expect(verifierAvoirs([e], ['44571'])).toEqual([]); // 44575 ne matche pas 44571 exactement en préfixe custom réduit
    expect(verifierAvoirs([e], ['4457'])).toHaveLength(1); // matche bien en préfixe plus court
  });
});
