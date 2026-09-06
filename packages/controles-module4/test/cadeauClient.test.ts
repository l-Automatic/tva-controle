import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { detecterCadeauClientSeuilDepasse } from '../src/cadeauClient.js';

function ecriture(overrides: {
  ledgerEntryId?: number;
  compteTva?: string;
  montantTva?: number;
  compteCadeau?: string;
  montantHt?: number;
}): EcritureTvaComplete {
  const ledgerEntryId = overrides.ledgerEntryId ?? 1;
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: overrides.compteTva ?? '44566',
      compteId: 1,
      libelle: null,
      debit: overrides.montantTva ?? 0,
      credit: 0,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [
      { id: 1, compte: overrides.compteCadeau ?? '6234', compteId: 1, libelle: null, debit: overrides.montantHt ?? 0, credit: 0 },
    ],
    lignesTiers: [],
  };
}

const config = { comptesCadeaux: ['6234'] };

describe('detecterCadeauClientSeuilDepasse', () => {
  it('ne signale rien sous le seuil (60€ TTC)', () => {
    const e = ecriture({ montantHt: 50, montantTva: 10 }); // 60€ TTC
    expect(detecterCadeauClientSeuilDepasse([e], config)).toEqual([]);
  });

  it('signale un cadeau au-delà du seuil avec TVA déduite', () => {
    const e = ecriture({ montantHt: 80, montantTva: 16 }); // 96€ TTC
    const anomalies = detecterCadeauClientSeuilDepasse([e], config);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('cadeau_client_seuil_depasse');
    expect(anomalies[0]?.gravite).toBe('bloquant');
    expect(anomalies[0]?.details).toMatchObject({ montantTtc: 96, montantTva: 16, seuil: 73 });
  });

  it('ne signale rien si aucune TVA n’est déduite, même au-delà du seuil', () => {
    const e = ecriture({ montantHt: 80, montantTva: 0 });
    expect(detecterCadeauClientSeuilDepasse([e], config)).toEqual([]);
  });

  it('ignore un compte qui n’est pas dans comptesCadeaux', () => {
    const e = ecriture({ compteCadeau: '6064', montantHt: 80, montantTva: 16 });
    expect(detecterCadeauClientSeuilDepasse([e], config)).toEqual([]);
  });

  it('respecte un seuil personnalisé', () => {
    const e = ecriture({ montantHt: 50, montantTva: 10 }); // 60€ TTC
    expect(detecterCadeauClientSeuilDepasse([e], { ...config, seuilTtc: 50 })).toHaveLength(1);
  });

  it('ignore une écriture qui ne touche pas 44566', () => {
    const e = ecriture({ compteTva: '44571', montantHt: 80, montantTva: 16 });
    expect(detecterCadeauClientSeuilDepasse([e], config)).toEqual([]);
  });
});
