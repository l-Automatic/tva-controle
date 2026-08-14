import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierExhaustiviteAutoliquidation } from '../src/exhaustiviteAutoliquidation.js';

function piece(
  ledgerEntryId: number,
  compteTva: string | null,
  compteCharge: string | null
): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: compteTva ?? '000',
      compteId: 1,
      libelle: null,
      debit: 100,
      credit: 0,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: compteCharge ? [{ id: 1, compte: compteCharge, compteId: 1, libelle: null, debit: 500, credit: 0 }] : [],
    lignesTiers: [],
  };
}

const config = {
  comptesChargeAutoliquidation: ['604AUTOLIQ'],
  compteTvaDueAutoliquidee: '4454',
  compteTvaDeductibleAutoliquidee: '445664',
};

describe('verifierExhaustiviteAutoliquidation', () => {
  it('ne signale rien quand les 3 comptes ont le même nombre de pièces', () => {
    const ecritures = [
      piece(1, '4454', '604AUTOLIQ'),
      piece(2, '445664', null),
      piece(3, '4454', null),
      piece(4, '445664', '604AUTOLIQ'),
    ];
    // Note: dans la vraie vie, charge+due+déductible sont souvent sur la
    // même pièce (2-3 lignes) ; ici on simule des pièces séparées par
    // simplicité, seul le COMPTE de la ligneTva ou d'autresLignes compte.
    expect(verifierExhaustiviteAutoliquidation(ecritures, config)).toEqual([]);
  });

  it('bloque quand une pièce de charge autoliquidation n’a pas de contrepartie TVA due', () => {
    const ecritures = [
      piece(1, null, '604AUTOLIQ'), // charge, mais aucune ligne 4454/445664 nulle part
    ];
    const anomalies = verifierExhaustiviteAutoliquidation(ecritures, config);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('autoliquidation_incomplete');
    expect(anomalies[0]?.gravite).toBe('bloquant');
    expect(anomalies[0]?.details).toMatchObject({ nbPiecesCharge: 1, nbPiecesDue: 0, nbPiecesDeductible: 0 });
  });

  it('ne fait rien sans convention comptesChargeAutoliquidation confirmée', () => {
    const ecritures = [piece(1, null, '604AUTOLIQ')];
    expect(
      verifierExhaustiviteAutoliquidation(ecritures, { ...config, comptesChargeAutoliquidation: [] })
    ).toEqual([]);
  });

  it('ne fait rien si aucune pièce ne touche le compte de charge autoliquidation', () => {
    const ecritures = [piece(1, '4454', null), piece(2, '445664', null)];
    expect(verifierExhaustiviteAutoliquidation(ecritures, config)).toEqual([]);
  });
});
