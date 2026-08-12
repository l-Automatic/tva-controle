import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierCoherenceCompteImmobilisation } from '../src/coherenceCompteImmobilisation.js';

function ecriture(compteTva: string, compteAutre: string, ledgerEntryId = 1): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: compteTva,
      compteId: 1,
      libelle: 'Achat immobilisation',
      debit: 200,
      credit: 0,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: compteAutre, compteId: 1, libelle: null, debit: 1000, credit: 0 }],
    lignesTiers: [],
  };
}

const config = { comptesImmobilisation: ['218', '215'] };

describe('verifierCoherenceCompteImmobilisation', () => {
  it('bloque si un compte immo confirmé est associé au 44566 au lieu du 44562', () => {
    const e = ecriture('44566', '2183');
    const anomalies = verifierCoherenceCompteImmobilisation([e], config);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('immobilisation_sur_compte_tva_incorrect');
    expect(anomalies[0]?.gravite).toBe('bloquant');
  });

  it('ne signale rien si le compte TVA est correctement le 44562', () => {
    const e = ecriture('44562', '2183');
    expect(verifierCoherenceCompteImmobilisation([e], config)).toEqual([]);
  });

  it('ignore une écriture qui ne touche aucun compte immobilisation confirmé', () => {
    const e = ecriture('44566', '607');
    expect(verifierCoherenceCompteImmobilisation([e], config)).toEqual([]);
  });

  it('sans aucun compte immobilisation configuré, ne fait rien', () => {
    const e = ecriture('44566', '2183');
    expect(verifierCoherenceCompteImmobilisation([e], { comptesImmobilisation: [] })).toEqual([]);
  });
});
