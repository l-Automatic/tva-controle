import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { detecterComptesTvaNonReconnus } from '../src/comptesNonReconnus.js';

function ecriture(compte: string, ledgerEntryId: number): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte,
      compteId: 1,
      libelle: null,
      debit: 0,
      credit: 100,
      date: '2025-01-15',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [],
    lignesTiers: [],
  };
}

describe('detecterComptesTvaNonReconnus', () => {
  it('ne signale rien sur les comptes standards reconnus', () => {
    const ecritures = [ecriture('445711', 1), ecriture('44566', 2), ecriture('44562', 3)];
    expect(detecterComptesTvaNonReconnus(ecritures, {})).toEqual([]);
  });

  it('ne signale rien sur les comptes d’autoliquidation configurés', () => {
    const ecritures = [ecriture('4454', 1), ecriture('445664', 2)];
    const anomalies = detecterComptesTvaNonReconnus(ecritures, {
      compteAutoliquidationDue: '4454',
      compteAutoliquidationDeductible: '445664',
    });
    expect(anomalies).toEqual([]);
  });

  it('signale en bloquant un compte d’autoliquidation NON configuré (pas dans les conventions)', () => {
    const ecritures = [ecriture('4454', 1)];
    const anomalies = detecterComptesTvaNonReconnus(ecritures, {}); // pas de convention fournie
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.gravite).toBe('bloquant');
    expect(anomalies[0]?.compte).toBe('4454');
  });

  it('whitelist 44551, 44567, 44583, 44586, 44587 sans les signaler', () => {
    const ecritures = [
      ecriture('44551', 1),
      ecriture('44567', 2),
      ecriture('44583', 3),
      ecriture('44586', 4),
      ecriture('44587', 5),
    ];
    expect(detecterComptesTvaNonReconnus(ecritures, {})).toEqual([]);
  });

  it('signale en bloquant un compte réellement inconnu (ex: intracom 4452)', () => {
    const ecritures = [ecriture('4452', 1)];
    const anomalies = detecterComptesTvaNonReconnus(ecritures, {});
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('compte_tva_non_reconnu');
    expect(anomalies[0]?.gravite).toBe('bloquant');
    expect(anomalies[0]?.description).toContain('intracom');
  });

  it('regroupe plusieurs écritures du même compte non reconnu en une seule anomalie, avec traçabilité complète', () => {
    const ecritures = [ecriture('4452', 1), ecriture('4452', 2), ecriture('4452', 3)];
    const anomalies = detecterComptesTvaNonReconnus(ecritures, {});
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.details).toEqual({ nbEcritures: 3, references: [1, 2, 3], exemplesLibelle: [] });
  });

  it('inclut des libellés d’exemple dans les details quand ils existent — seule info réellement recherchable dans Pennylane, l’id interne ne l’est pas', () => {
    function ecritureAvecLibelle(compte: string, ledgerEntryId: number, libelle: string): EcritureTvaComplete {
      return {
        ledgerEntryId,
        ligneTva: {
          id: ledgerEntryId,
          compte,
          compteId: 1,
          libelle,
          debit: 0,
          credit: 100,
          date: '2025-01-15',
          ledgerEntryId,
          lettrage: { estLettree: false, groupeIds: [] },
        },
        autresLignes: [],
        lignesTiers: [],
      };
    }
    const ecritures = [
      ecritureAvecLibelle('4452', 1, 'FACT INTRACOM 001'),
      ecritureAvecLibelle('4452', 2, 'FACT INTRACOM 002'),
    ];
    const anomalies = detecterComptesTvaNonReconnus(ecritures, {});
    expect(anomalies[0]?.details).toEqual({
      nbEcritures: 2,
      references: [1, 2],
      exemplesLibelle: ['FACT INTRACOM 001', 'FACT INTRACOM 002'],
    });
  });
});

describe('detecterComptesTvaNonReconnus — TVA intracom (10/08)', () => {
  it('reconnaît 4452 (due) et 445662 (déductible) quand confirmés en convention', () => {
    const ecritures = [ecriture('4452', 1), ecriture('445662', 2)];
    const anomalies = detecterComptesTvaNonReconnus(ecritures, {
      compteAutoliquidationDueIntracom: '4452',
      compteAutoliquidationDeductibleIntracom: '445662',
    });
    expect(anomalies).toEqual([]);
  });

  it('signale toujours 4452 comme non reconnu si la convention intracom n’est pas confirmée', () => {
    const anomalies = detecterComptesTvaNonReconnus([ecriture('4452', 1)], {});
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.compte).toBe('4452');
  });
});
