import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { identifierComptesSansTauxAssigne, identifierComptesClientSansTaux } from '../src/tauxSuggestions.js';

function ecriture(
  autresLignes: EcritureTvaComplete['autresLignes'],
  lignesTiers: EcritureTvaComplete['lignesTiers'] = []
): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: '445711',
      compteId: 1,
      libelle: null,
      debit: 0,
      credit: 100,
      date: '2025-01-01',
      ledgerEntryId: 1,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    lignesTiers,
    autresLignes,
  };
}

describe('identifierComptesSansTauxAssigne', () => {
  it('signale un compte de produit sans taux assigné', () => {
    const e = ecriture([{ id: 1, compte: '706', compteId: 1, libelle: 'Vente marchandises', debit: 0, credit: 100 }]);
    expect(identifierComptesSansTauxAssigne([e], [])).toEqual([
      { compte: '706', exemplesLibelle: ['Vente marchandises'] },
    ]);
  });

  it('ignore un compte déjà assigné', () => {
    const e = ecriture([{ id: 1, compte: '706', compteId: 1, libelle: null, debit: 0, credit: 100 }]);
    expect(identifierComptesSansTauxAssigne([e], ['706'])).toEqual([]);
  });

  it('ignore un compte hors classes 6/7 (ex: 5121 trésorerie, 2183 immo brute)', () => {
    const e = ecriture([
      { id: 1, compte: '5121', compteId: 1, libelle: null, debit: 500, credit: 0 },
      { id: 2, compte: '607', compteId: 2, libelle: null, debit: 100, credit: 0 },
    ]);
    expect(identifierComptesSansTauxAssigne([e], []).map((c) => c.compte)).toEqual(['607']);
  });
});

describe('identifierComptesClientSansTaux', () => {
  it('signale un compte client sans taux connu', () => {
    const e = ecriture(
      [],
      [
        {
          compte: '411ROUSSEAU',
          compteId: 1,
          libelleCompte: 'CLIENT ROUSSEAU',
          debit: 100,
          credit: 0,
          lettrage: { estLettree: true, groupeIds: [] },
        },
      ]
    );
    expect(identifierComptesClientSansTaux([e], [])).toEqual([
      { numeroCompteTiers: '411ROUSSEAU', nomTiers: 'CLIENT ROUSSEAU' },
    ]);
  });

  it('ignore un compte client déjà connu', () => {
    const e = ecriture(
      [],
      [
        {
          compte: '411ROUSSEAU',
          compteId: 1,
          libelleCompte: null,
          debit: 100,
          credit: 0,
          lettrage: { estLettree: true, groupeIds: [] },
        },
      ]
    );
    expect(identifierComptesClientSansTaux([e], ['411ROUSSEAU'])).toEqual([]);
  });

  it('dédoublonne un même client apparaissant sur plusieurs écritures', () => {
    const ligneTiers = {
      compte: '411X',
      compteId: 1,
      libelleCompte: null,
      debit: 100,
      credit: 0,
      lettrage: { estLettree: true, groupeIds: [] },
    };
    const ecritures = [ecriture([], [ligneTiers]), ecriture([], [ligneTiers])];
    expect(identifierComptesClientSansTaux(ecritures, [])).toHaveLength(1);
  });
});
