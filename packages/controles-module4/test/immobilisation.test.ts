import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { detecterImmobilisationManquee } from '../src/immobilisation.js';

const config = { comptesEquipement: ['6063'] };

function ecriture(overrides: Partial<EcritureTvaComplete> = {}): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: '44566',
      compteId: 1,
      libelle: null,
      debit: 120,
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

describe('detecterImmobilisationManquee', () => {
  it('signale un achat de petit équipement au-dessus du seuil', () => {
    const e = ecriture({
      autresLignes: [{ id: 1, compte: '6063', compteId: 1, libelle: null, debit: 600, credit: 0 }],
    });
    const anomalies = detecterImmobilisationManquee([e], config);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('immobilisation_potentielle_non_passee');
    expect(anomalies[0]?.gravite).toBe('signale'); // jamais bloquant
  });

  it('ne signale rien en dessous du seuil', () => {
    const e = ecriture({
      autresLignes: [{ id: 1, compte: '6063', compteId: 1, libelle: null, debit: 350, credit: 0 }],
    });
    expect(detecterImmobilisationManquee([e], config)).toEqual([]);
  });

  it('ne signale rien sur un compte hors config', () => {
    const e = ecriture({
      autresLignes: [{ id: 1, compte: '607', compteId: 1, libelle: null, debit: 900, credit: 0 }],
    });
    expect(detecterImmobilisationManquee([e], config)).toEqual([]);
  });

  it('regroupe plusieurs lignes qualifiantes de la même pièce en une seule anomalie', () => {
    const e = ecriture({
      ledgerEntryId: 5,
      ligneTva: { ...ecriture().ligneTva, ledgerEntryId: 5 },
      autresLignes: [
        { id: 1, compte: '6063', compteId: 1, libelle: null, debit: 600, credit: 0 },
        { id: 2, compte: '6063', compteId: 2, libelle: null, debit: 700, credit: 0 },
      ],
    });

    const anomalies = detecterImmobilisationManquee([e], config);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.details).toMatchObject({
      lignes: [{ compte: '6063', montant: 600 }, { compte: '6063', montant: 700 }],
    });
  });

  it('respecte le seuil personnalisé', () => {
    const e = ecriture({
      autresLignes: [{ id: 1, compte: '6063', compteId: 1, libelle: null, debit: 250, credit: 0 }],
    });
    const anomalies = detecterImmobilisationManquee([e], { ...config, seuilHT: 200 });
    expect(anomalies).toHaveLength(1);
  });

  it('n’émet rien pour une pièce déjà vérifiée lors d’une CA3 antérieure', () => {
    const e = ecriture({
      autresLignes: [{ id: 1, compte: '6063', compteId: 1, libelle: null, debit: 600, credit: 0 }],
    });
    const anomalies = detecterImmobilisationManquee([e], {
      ...config,
      referencesDejaVerifiees: new Set([1]),
    });
    expect(anomalies).toEqual([]);
  });
});
