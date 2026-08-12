import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierCoherenceTauxAutoliquidation } from '../src/coherenceAutoliquidation.js';

function ecriture(
  ledgerEntryId: number,
  montantTva: number,
  compteCharge: string,
  montantHt: number,
  compteTva = '445664'
): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: compteTva,
      compteId: 1,
      libelle: null,
      debit: montantTva,
      credit: 0,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: compteCharge, compteId: 1, libelle: null, debit: montantHt, credit: 0 }],
    lignesTiers: [],
  };
}

const config = { compteTvaDeductibleAutoliquidee: '445664' };

describe('verifierCoherenceTauxAutoliquidation', () => {
  it('ne signale rien si tout le compte 604 autoliquidation est cohérent à 20%', () => {
    const ecritures = [
      ecriture(1, 200, '604AUTOLIQ', 1000),
      ecriture(2, 200, '604AUTOLIQ', 1000),
      ecriture(3, 200, '604AUTOLIQ', 1000),
    ];
    expect(verifierCoherenceTauxAutoliquidation(ecritures, config)).toEqual([]);
  });

  it('signale la ligne qui dévie du taux dominant du même compte', () => {
    const ecritures = [
      ecriture(1, 200, '604AUTOLIQ', 1000), // 20%
      ecriture(2, 200, '604AUTOLIQ', 1000), // 20%
      ecriture(3, 100, '604AUTOLIQ', 1000), // 10%, dévie
    ];
    const anomalies = verifierCoherenceTauxAutoliquidation(ecritures, config);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.ledgerEntryId).toBe(3);
    expect(anomalies[0]?.type).toBe('incoherence_taux_autoliquidation');
  });

  it('traite chaque compte de charge séparément — un 604 classique à 20% différent du 604 autoliquidation à 10%', () => {
    const ecritures = [
      ecriture(1, 200, '604AUTOLIQ20', 1000),
      ecriture(2, 100, '604AUTOLIQ10', 1000),
      ecriture(3, 100, '604AUTOLIQ10', 1000),
    ];
    expect(verifierCoherenceTauxAutoliquidation(ecritures, config)).toEqual([]);
  });

  it('ignore les écritures qui ne concernent pas le compte de TVA déductible autoliquidée configuré', () => {
    const e = ecriture(1, 200, '604', 1000, '44566');
    expect(verifierCoherenceTauxAutoliquidation([e], config)).toEqual([]);
  });

  it('ignore une écriture sans ligne de charge associée', () => {
    const e: EcritureTvaComplete = {
      ledgerEntryId: 1,
      ligneTva: {
        id: 1,
        compte: '445664',
        compteId: 1,
        libelle: null,
        debit: 200,
        credit: 0,
        date: '2025-01-01',
        ledgerEntryId: 1,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [],
      lignesTiers: [],
    };
    expect(verifierCoherenceTauxAutoliquidation([e], config)).toEqual([]);
  });
});
