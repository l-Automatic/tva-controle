import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierCoherenceTauxProduit, agregerBaseHtParTaux } from '../src/coherenceTauxProduit.js';

function ecriture(
  ledgerEntryId: number,
  montantTva: number,
  compteProduit: string,
  montantHt: number,
  compteTva = '445711'
): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: compteTva,
      compteId: 1,
      libelle: null,
      debit: 0,
      credit: montantTva,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: compteProduit, compteId: 1, libelle: null, debit: 0, credit: montantHt }],
    lignesTiers: [],
  };
}

describe('verifierCoherenceTauxProduit', () => {
  it('ne signale rien si tout le compte produit est cohérent à 20%', () => {
    const ecritures = [
      ecriture(1, 200, '706100', 1000),
      ecriture(2, 200, '706100', 1000),
      ecriture(3, 200, '706100', 1000),
    ];
    expect(verifierCoherenceTauxProduit(ecritures)).toEqual([]);
  });

  it('signale la ligne qui dévie du taux dominant du même compte produit', () => {
    const ecritures = [
      ecriture(1, 200, '706100', 1000), // 20%
      ecriture(2, 200, '706100', 1000), // 20%
      ecriture(3, 100, '706100', 1000), // 10%, dévie
    ];
    const anomalies = verifierCoherenceTauxProduit(ecritures);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.ledgerEntryId).toBe(3);
    expect(anomalies[0]?.type).toBe('incoherence_taux_produit');
    expect(anomalies[0]?.gravite).toBe('bloquant');
    expect(anomalies[0]?.compte).toBe('706100');
  });

  it('fonctionne indépendamment du compte de collecte — même compte 44571 générique pour deux taux distincts sur deux comptes produit différents', () => {
    // Le point central de ce contrôle : contrairement à
    // verifierCoherenceTauxCollecte, celui-ci n'a pas besoin que le compte
    // de collecte soit lui-même éclaté par taux.
    const ecritures = [
      ecriture(1, 200, '706100', 1000, '44571'), // 706100 à 20%, compte collecte générique
      ecriture(2, 200, '706100', 1000, '44571'),
      ecriture(3, 100, '706200', 1000, '44571'), // 706200 à 10%, même compte collecte générique
      ecriture(4, 100, '706200', 1000, '44571'),
      ecriture(5, 50, '706200', 1000, '44571'), // 706200 dévie à 5%
    ];
    const anomalies = verifierCoherenceTauxProduit(ecritures);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.ledgerEntryId).toBe(5);
    expect(anomalies[0]?.compte).toBe('706200');
  });

  it('deux comptes produit à taux différents, chacun cohérent avec lui-même : aucune anomalie', () => {
    const ecritures = [
      ecriture(1, 200, '706100', 1000), // 20%
      ecriture(2, 100, '706200', 1000), // 10%
    ];
    expect(verifierCoherenceTauxProduit(ecritures)).toEqual([]);
  });

  it('ignore les écritures sans ligne produit associée ou base HT nulle, sans planter', () => {
    const sansAutresLignes: EcritureTvaComplete = {
      ledgerEntryId: 1,
      ligneTva: {
        id: 1,
        compte: '445711',
        compteId: 1,
        libelle: null,
        debit: 0,
        credit: 100,
        date: '2025-01-01',
        ledgerEntryId: 1,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [],
      lignesTiers: [],
    };
    expect(verifierCoherenceTauxProduit([sansAutresLignes])).toEqual([]);
  });
});

describe('agregerBaseHtParTaux', () => {
  it('agrège la base HT par taux, total garanti par construction = somme des détails', () => {
    const ecritures = [
      ecriture(1, 200, '706100', 1000), // 20% : 1000 HT
      ecriture(2, 100, '706200', 1000), // 10% : 1000 HT
      ecriture(3, 55, '706300', 1000), // 5,5% : 1000 HT
      ecriture(4, 21, '706400', 1000), // 2,1% : 1000 HT
    ];
    const resultat = agregerBaseHtParTaux(ecritures);
    expect(resultat.parTaux).toEqual({ taux20: 1000, taux10: 1000, taux5_5: 1000, taux2_1: 1000 });
    expect(resultat.total).toBe(4000);
    expect(resultat.total).toBe(
      resultat.parTaux.taux20 + resultat.parTaux.taux10 + resultat.parTaux.taux5_5 + resultat.parTaux.taux2_1
    );
  });

  it('cumule plusieurs lignes sur le même taux', () => {
    const ecritures = [ecriture(1, 200, '706100', 1000), ecriture(2, 400, '706100', 2000)];
    expect(agregerBaseHtParTaux(ecritures).parTaux.taux20).toBe(3000);
  });

  it('exclut les ventes exonérées (aucune ligne 44571), naturellement — pas de faux calcul', () => {
    expect(agregerBaseHtParTaux([])).toEqual({ total: 0, parTaux: { taux20: 0, taux10: 0, taux5_5: 0, taux2_1: 0 } });
  });

  it('ignore une écriture qui ne touche pas 44571x', () => {
    const e = ecriture(1, 200, '706100', 1000, '44566'); // pas une collecte
    expect(agregerBaseHtParTaux([e])).toEqual({ total: 0, parTaux: { taux20: 0, taux10: 0, taux5_5: 0, taux2_1: 0 } });
  });

  it('exclut un taux non officiel plutôt que de le compter sous un taux arbitraire', () => {
    const e = ecriture(1, 150, '706100', 1000); // 15%, jamais un taux officiel
    expect(agregerBaseHtParTaux([e])).toEqual({ total: 0, parTaux: { taux20: 0, taux10: 0, taux5_5: 0, taux2_1: 0 } });
  });
});
