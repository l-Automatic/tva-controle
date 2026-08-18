import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierCoherenceTvaHotel } from '../src/coherenceHotel.js';

function ecriture(montantTva: number, compteFournisseur: string, ledgerEntryId = 1): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: '44566',
      compteId: 1,
      libelle: null,
      debit: montantTva,
      credit: 0,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: '6251', compteId: 1, libelle: null, debit: 500, credit: 0 }],
    lignesTiers: [
      {
        compte: compteFournisseur,
        compteId: 1,
        libelleCompte: null,
        debit: 0,
        credit: 600,
        lettrage: { estLettree: false, groupeIds: [] },
      },
    ],
  };
}

describe('verifierCoherenceTvaHotel', () => {
  it('bloque si une TVA est déduite sur un fournisseur identifié comme hôtel', () => {
    const noms = new Map([['401HOTEL', 'HOTELS']]);
    const anomalies = verifierCoherenceTvaHotel([ecriture(100, '401HOTEL')], noms);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('tva_hotel_a_tort');
    expect(anomalies[0]?.gravite).toBe('bloquant');
  });

  it('accepte "hôtel" avec accent aussi bien que sans', () => {
    const noms = new Map([['401X', 'Hôtellerie Générale']]);
    expect(verifierCoherenceTvaHotel([ecriture(100, '401X')], noms)).toHaveLength(1);
  });

  it('ne signale rien si aucune TVA n’est portée sur la pièce (comportement correct attendu)', () => {
    const noms = new Map([['401HOTEL', 'HOTELS']]);
    expect(verifierCoherenceTvaHotel([ecriture(0, '401HOTEL')], noms)).toEqual([]);
  });

  it('ne signale rien pour un fournisseur non identifié comme hôtel', () => {
    const noms = new Map([['401DUPONT', 'DUPONT SARL']]);
    expect(verifierCoherenceTvaHotel([ecriture(100, '401DUPONT')], noms)).toEqual([]);
  });

  it('ne signale rien si le nom du fournisseur n’a pas pu être résolu', () => {
    expect(verifierCoherenceTvaHotel([ecriture(100, '401INCONNU')], new Map())).toEqual([]);
  });

  it('ignore les écritures hors 44566 (ex: 44562 immobilisations)', () => {
    const e = ecriture(100, '401HOTEL');
    e.ligneTva.compte = '44562';
    const noms = new Map([['401HOTEL', 'HOTELS']]);
    expect(verifierCoherenceTvaHotel([e], noms)).toEqual([]);
  });
});
