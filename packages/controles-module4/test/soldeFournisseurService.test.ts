import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { identifierFournisseursService } from '../src/soldeFournisseurService.js';

function ecriture(overrides: Partial<EcritureTvaComplete> = {}): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: '44566',
      compteId: 1,
      libelle: null,
      debit: 100,
      credit: 0,
      date: '2025-01-15',
      ledgerEntryId: 1,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [],
    lignesTiers: [],
    ...overrides,
  };
}

const config = { comptesChargeService: ['611', '604'] };

describe('identifierFournisseursService', () => {
  it('identifie le fournisseur d’un achat de service déductible', () => {
    const e = ecriture({
      autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        {
          compte: '401SOUSTRAITANT',
          compteId: 1,
          libelleCompte: 'Sous-traitant X',
          debit: 0,
          credit: 600,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });

    expect(identifierFournisseursService([e], config)).toEqual(['401SOUSTRAITANT']);
  });

  it('ignore un achat de bien (compte de charge hors comptesChargeService)', () => {
    const e = ecriture({
      autresLignes: [{ id: 1, compte: '607', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        {
          compte: '401FOURNISSEURBIEN',
          compteId: 1,
          libelleCompte: 'Fournisseur biens',
          debit: 0,
          credit: 600,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });

    expect(identifierFournisseursService([e], config)).toEqual([]);
  });

  it('ignore une écriture de TVA collectée, même sur un compte listé par erreur', () => {
    const e = ecriture({
      ligneTva: { ...ecriture().ligneTva, compte: '445711' },
      autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 0, credit: 500 }],
      lignesTiers: [
        {
          compte: '401X',
          compteId: 1,
          libelleCompte: null,
          debit: 0,
          credit: 600,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });

    expect(identifierFournisseursService([e], config)).toEqual([]);
  });

  it('ignore un compte 44562 (immobilisations) — hors périmètre de cette correction', () => {
    const e = ecriture({
      ligneTva: { ...ecriture().ligneTva, compte: '44562' },
      autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        {
          compte: '401IMMO',
          compteId: 1,
          libelleCompte: null,
          debit: 0,
          credit: 600,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });

    expect(identifierFournisseursService([e], config)).toEqual([]);
  });

  it('dédoublonne un même fournisseur apparaissant sur plusieurs pièces', () => {
    const ligneTiers = {
      compte: '401RECURRENT',
      compteId: 1,
      libelleCompte: null,
      debit: 0,
      credit: 100,
      lettrage: { estLettree: false, groupeIds: [] },
    };
    const ecritures = [
      ecriture({
        ledgerEntryId: 1,
        autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 100, credit: 0 }],
        lignesTiers: [ligneTiers],
      }),
      ecriture({
        ledgerEntryId: 2,
        autresLignes: [{ id: 2, compte: '611', compteId: 1, libelle: null, debit: 200, credit: 0 }],
        lignesTiers: [ligneTiers],
      }),
    ];

    expect(identifierFournisseursService(ecritures, config)).toEqual(['401RECURRENT']);
  });
});
