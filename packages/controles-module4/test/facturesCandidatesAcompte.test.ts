import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { identifierFacturesCandidatesAcompte } from '../src/facturesCandidatesAcompte.js';

function ecriture(opts: {
  compteCharge: string;
  estLettree: boolean;
  montantTva?: number;
  compteTiers?: string;
}): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: '44566',
      compteId: 1,
      libelle: 'FACTURE CONSEIL',
      debit: opts.montantTva ?? 100,
      credit: 0,
      date: '2025-01-15',
      ledgerEntryId: 1,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: opts.compteCharge, compteId: 1, libelle: null, debit: 500, credit: 0 }],
    lignesTiers: [
      {
        compte: opts.compteTiers ?? '401CONSEIL',
        compteId: 42,
        libelleCompte: null,
        debit: 0,
        credit: 600,
        lettrage: { estLettree: opts.estLettree, groupeIds: opts.estLettree ? [1, 2] : [] },
      },
    ],
  };
}

const comptesChargeService = ['604', '611'];

describe('identifierFacturesCandidatesAcompte', () => {
  it('propose une facture de service non lettrée', () => {
    const e = ecriture({ compteCharge: '604CONSEIL', estLettree: false });
    const resultat = identifierFacturesCandidatesAcompte([e], comptesChargeService);
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.compteTiersId).toBe(42);
    expect(resultat[0]?.montantFactureTotal).toBe(600); // ligneTiers.credit
  });

  it('exclut une facture de bien, même non lettrée', () => {
    const e = ecriture({ compteCharge: '607', estLettree: false });
    expect(identifierFacturesCandidatesAcompte([e], comptesChargeService)).toEqual([]);
  });

  it('exclut une facture déjà lettrée (traitée par le contrôle existant, pas celui-ci)', () => {
    const e = ecriture({ compteCharge: '604CONSEIL', estLettree: true });
    expect(identifierFacturesCandidatesAcompte([e], comptesChargeService)).toEqual([]);
  });

  it('exclut une écriture sans TVA', () => {
    const e = ecriture({ compteCharge: '604CONSEIL', estLettree: false, montantTva: 0 });
    expect(identifierFacturesCandidatesAcompte([e], comptesChargeService)).toEqual([]);
  });

  it('ignore les écritures hors 44566', () => {
    const e = ecriture({ compteCharge: '604CONSEIL', estLettree: false });
    e.ligneTva.compte = '44562';
    expect(identifierFacturesCandidatesAcompte([e], comptesChargeService)).toEqual([]);
  });

  it('inclut un compte hors comptes_charge_service (625) si marqué en exception forcée (hôtel)', () => {
    const e = ecriture({ compteCharge: '6251', estLettree: false });
    const sansException = identifierFacturesCandidatesAcompte([e], comptesChargeService);
    expect(sansException).toEqual([]); // 625 n'est pas dans comptes_charge_service, exclu normalement

    const avecException = identifierFacturesCandidatesAcompte(
      [e],
      comptesChargeService,
      new Set([1]) // ledgerEntryId 1, forcé en exception
    );
    expect(avecException).toHaveLength(1);
  });
});
