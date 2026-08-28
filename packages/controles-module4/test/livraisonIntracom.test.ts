import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierAbsenceTvaLivraisonIntracom } from '../src/livraisonIntracom.js';

function ecriture(montantTva: number, compteVente: string, ledgerEntryId = 1): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: '445711',
      compteId: 1,
      libelle: 'VENTE UE',
      debit: 0,
      credit: montantTva,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: compteVente, compteId: 1, libelle: null, debit: 0, credit: 1000 }],
    lignesTiers: [],
  };
}

const comptes = ['7062'];

describe('verifierAbsenceTvaLivraisonIntracom', () => {
  it('bloque si de la TVA est présente sur une pièce touchant le compte de livraison intracom exonérée', () => {
    const anomalies = verifierAbsenceTvaLivraisonIntracom([ecriture(200, '7062')], comptes);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('tva_sur_livraison_intracom_exoneree');
    expect(anomalies[0]?.gravite).toBe('bloquant');
  });

  it('ne signale rien pour une pièce qui ne touche pas ce compte', () => {
    expect(verifierAbsenceTvaLivraisonIntracom([ecriture(200, '706')], comptes)).toEqual([]);
  });

  it('ignore une TVA à zéro (ne devrait pas apparaître dans les données réelles, mais prudence)', () => {
    expect(verifierAbsenceTvaLivraisonIntracom([ecriture(0, '7062')], comptes)).toEqual([]);
  });

  it('sans convention configurée, ne fait rien', () => {
    expect(verifierAbsenceTvaLivraisonIntracom([ecriture(200, '7062')], [])).toEqual([]);
  });
});
