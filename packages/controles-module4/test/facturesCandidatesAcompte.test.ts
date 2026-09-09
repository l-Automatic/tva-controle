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

  it('exclut une facture lettrée même dans un groupe à plusieurs pièces — le lettrage Pennylane équilibre forcément à zéro (correction du 10/08, après une première extension erronée)', () => {
    const e = ecriture({ compteCharge: '604CONSEIL', estLettree: true });
    e.lignesTiers[0]!.lettrage = { estLettree: true, groupeIds: [1, 2, 3] };
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

  it('un compte hors comptes_charge_service (625, ex-hôtel) n’est jamais candidat sans être confirmé — plus d’exception spéciale (10/08, demande de Rami)', () => {
    const e = ecriture({ compteCharge: '6251', estLettree: false });
    expect(identifierFacturesCandidatesAcompte([e], comptesChargeService)).toEqual([]);
    // Redevient candidat une fois catégorisé normalement, comme n'importe
    // quel autre fournisseur — plus de mécanisme spécial.
    expect(identifierFacturesCandidatesAcompte([e], ['6251'])).toHaveLength(1);
  });
});

function ecritureAutoliquidation(opts: { compteTva: string; compteCharge: string; estLettree: boolean }): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: opts.compteTva,
      compteId: 1,
      libelle: 'Sous-traitance',
      debit: 100,
      credit: 0,
      date: '2025-01-15',
      ledgerEntryId: 1,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: opts.compteCharge, compteId: 1, libelle: null, debit: 500, credit: 0 }],
    lignesTiers: [
      {
        compte: '401SOUS01',
        compteId: 42,
        libelleCompte: null,
        debit: 0,
        credit: 600,
        lettrage: { estLettree: opts.estLettree, groupeIds: opts.estLettree ? [1, 2] : [] },
      },
    ],
  };
}

describe('identifierFacturesCandidatesAcompte — autoliquidation (10/08, bug réel corrigé)', () => {
  it('BTP (445664) non payé, compte de charge en comptesChargeAutoliquidation : candidat', () => {
    const e = ecritureAutoliquidation({ compteTva: '445664', compteCharge: '604000', estLettree: false });
    const resultat = identifierFacturesCandidatesAcompte(
      [e],
      [], // comptesChargeService vide — c'est comptesChargeAutoliquidation qui doit matcher
      ['604000']
    );
    expect(resultat).toHaveLength(1);
  });

  it('BTP (445664) non payé, sans comptesChargeAutoliquidation confirmé : jamais candidat', () => {
    const e = ecritureAutoliquidation({ compteTva: '445664', compteCharge: '604000', estLettree: false });
    const resultat = identifierFacturesCandidatesAcompte([e], [], []);
    expect(resultat).toEqual([]);
  });

  it('intracom (445662) jamais candidat, même non payé et même compte de charge confirmé — exigibilité indépendante du paiement', () => {
    const e = ecritureAutoliquidation({ compteTva: '445662', compteCharge: '604000', estLettree: false });
    const resultat = identifierFacturesCandidatesAcompte(
      [e],
      [],
      ['604000'], // même si le compte de charge est confirmé
      ['445662'] // explicitement exclu
    );
    expect(resultat).toEqual([]);
  });
});
