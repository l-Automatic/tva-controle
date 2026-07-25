import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { verifierCoherenceTauxCollecte } from '../src/coherenceTaux.js';
import { verifierAutoliquidationEquilibree } from '../src/autoliquidation.js';
import { verifierAvoirsCollecte } from '../src/avoirs.js';
import { executerPreControles } from '../src/index.js';

// Construit une EcritureTvaComplete minimale pour les tests. Les montants par
// défaut correspondent au cas réel ROUSSEAU (déjà validé bout-en-bout dans
// tvaEcrituresCompletes.test.ts) ; les tests d'anomalie surchargent ce qu'il
// faut pour provoquer le cas testé.
function construireEcriture(overrides: Partial<EcritureTvaComplete> = {}): EcritureTvaComplete {
  return {
    ledgerEntryId: 22495307276288,
    ligneTva: {
      id: 92522389344256,
      compte: '445711',
      compteId: 12028930117632,
      libelle: 'ROUSSEAU VIR 21/01',
      debit: 0,
      credit: 711.03,
      date: '2025-01-21',
      ledgerEntryId: 22495307276288,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    lignesTiers: [],
    autresLignes: [
      {
        id: 92522389352448,
        compte: '7061',
        compteId: 12028930121728,
        libelle: 'ROUSSEAU VIR 21/01',
        debit: 0,
        credit: 3555.14,
      },
    ],
    ...overrides,
  };
}

describe('verifierCoherenceTauxCollecte', () => {
  it('ne remonte aucune anomalie sur le cas réel ROUSSEAU (711.03 / 3555.14 ≈ 20%)', () => {
    const anomalies = verifierCoherenceTauxCollecte([construireEcriture()]);
    expect(anomalies).toEqual([]);
  });

  it('détecte un taux implicite incohérent avec le compte utilisé', () => {
    const ecriture = construireEcriture({
      ligneTva: {
        ...construireEcriture().ligneTva,
        compte: '445712', // attendu 10%
        credit: 200, // mais 200/1000 = 20% : incohérent avec un compte à 10%
      },
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 },
      ],
    });

    const anomalies = verifierCoherenceTauxCollecte([ecriture]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('taux_incoherent');
    expect(anomalies[0]?.gravite).toBe('bloquant');
  });

  it('escalade au lieu de calculer sur une pièce multi-taux non éclatée', () => {
    const piece = 999;
    const ligne20 = construireEcriture({
      ledgerEntryId: piece,
      ligneTva: { ...construireEcriture().ligneTva, compte: '445711', ledgerEntryId: piece },
    });
    const ligne10 = construireEcriture({
      ledgerEntryId: piece,
      ligneTva: { ...construireEcriture().ligneTva, compte: '445712', ledgerEntryId: piece },
    });

    const anomalies = verifierCoherenceTauxCollecte([ligne20, ligne10]);
    expect(anomalies).toHaveLength(2);
    expect(anomalies.every((a) => a.type === 'taux_multi_non_eclate')).toBe(true);
    expect(anomalies.every((a) => a.gravite === 'signale')).toBe(true);
  });

  it('signale plutôt que de planter sur une base HT nulle', () => {
    const ecriture = construireEcriture({ autresLignes: [] });
    const anomalies = verifierCoherenceTauxCollecte([ecriture]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('base_ht_nulle');
  });

  it('ignore les comptes hors mapping (ex: 44566, pas de taux nominal unique)', () => {
    const ecriture = construireEcriture({
      ligneTva: { ...construireEcriture().ligneTva, compte: '44566' },
    });
    const anomalies = verifierCoherenceTauxCollecte([ecriture]);
    expect(anomalies).toEqual([]);
  });
});

describe('verifierCoherenceTauxCollecte — priorité à la convention du dossier', () => {
  it('ne remonte rien si le taux implicite correspond au taux HABITUEL DU DOSSIER, même s’il diffère du taux national', () => {
    // Dossier dont le compte 445712 a historiquement un taux de 8% (cas
    // inhabituel mais réel pour ce dossier) — pas 10% comme le national.
    const contexteDossier = {
      tauxHistorique: [{ compteOuTiers: '445712', tauxHabituel: 8, nbOccurrences: 12 }],
      conventions: [],
      parcVehicules: [],
    };
    const ecriture = construireEcriture({
      ligneTva: { ...construireEcriture().ligneTva, compte: '445712', credit: 80 }, // 80/1000 = 8%
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 },
      ],
    });

    // Sans contexte dossier : 8% vs national 10% -> anomalie
    const sansContexte = verifierCoherenceTauxCollecte([ecriture]);
    expect(sansContexte).toHaveLength(1);
    expect(sansContexte[0]?.type).toBe('taux_incoherent');

    // Avec contexte dossier : 8% vs habituel du dossier 8% -> rien
    const avecContexte = verifierCoherenceTauxCollecte(
      [ecriture],
      undefined,
      0.5,
      contexteDossier
    );
    expect(avecContexte).toEqual([]);
  });

  it('remonte une anomalie si le taux implicite correspond au national mais PAS au taux habituel du dossier', () => {
    // Le dossier attend 8% sur ce compte, mais cette écriture est à 10% (le
    // taux national "normal") — c'est justement l'écart à détecter : soit
    // une saisie sur le mauvais sous-compte, soit un changement à confirmer.
    const contexteDossier = {
      tauxHistorique: [{ compteOuTiers: '445712', tauxHabituel: 8, nbOccurrences: 12 }],
      conventions: [],
      parcVehicules: [],
    };
    const ecriture = construireEcriture({
      ligneTva: { ...construireEcriture().ligneTva, compte: '445712', credit: 100 }, // 100/1000 = 10%
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 },
      ],
    });

    const anomalies = verifierCoherenceTauxCollecte([ecriture], undefined, 0.5, contexteDossier);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.details).toMatchObject({ tauxAttendu: 8, sourceTaux: 'convention_dossier' });
  });

  it('retombe sur le taux national si le dossier n’a pas encore d’historique pour ce compte', () => {
    const contexteDossier = { tauxHistorique: [], conventions: [], parcVehicules: [] }; // dossier vide, tout juste onboardé
    const anomalies = verifierCoherenceTauxCollecte(
      [construireEcriture()], // cas réel ROUSSEAU, 20% pile
      undefined,
      0.5,
      contexteDossier
    );
    expect(anomalies).toEqual([]);
  });
});

describe('verifierAutoliquidationEquilibree', () => {
  it('ne remonte rien sur le cas réel CABLES PRO (4454 = 445664 = 734.75)', () => {
    const piece = 22495307124736;
    const ligneDeductible = construireEcriture({
      ledgerEntryId: piece,
      ligneTva: {
        ...construireEcriture().ligneTva,
        compte: '445664',
        ledgerEntryId: piece,
        debit: 734.75,
        credit: 0,
      },
    });
    const ligneDue = construireEcriture({
      ledgerEntryId: piece,
      ligneTva: {
        ...construireEcriture().ligneTva,
        compte: '4454',
        ledgerEntryId: piece,
        debit: 0,
        credit: 734.75,
      },
    });

    const anomalies = verifierAutoliquidationEquilibree([ligneDeductible, ligneDue]);
    expect(anomalies).toEqual([]);
  });

  it('détecte une TVA due sans contrepartie déductible', () => {
    const ligneDue = construireEcriture({
      ligneTva: { ...construireEcriture().ligneTva, compte: '4454', credit: 500, debit: 0 },
    });
    const anomalies = verifierAutoliquidationEquilibree([ligneDue]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('autoliquidation_desequilibree');
    expect(anomalies[0]?.gravite).toBe('bloquant');
  });

  it('détecte des montants différents entre due et déductible sur la même pièce', () => {
    const piece = 42;
    const ligneDue = construireEcriture({
      ledgerEntryId: piece,
      ligneTva: { ...construireEcriture().ligneTva, compte: '4454', ledgerEntryId: piece, credit: 500, debit: 0 },
    });
    const ligneDeductible = construireEcriture({
      ledgerEntryId: piece,
      ligneTva: {
        ...construireEcriture().ligneTva,
        compte: '445664',
        ledgerEntryId: piece,
        debit: 480,
        credit: 0,
      },
    });

    const anomalies = verifierAutoliquidationEquilibree([ligneDue, ligneDeductible]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.details).toEqual({ montantDue: 500, montantDeductible: 480 });
  });
});

describe('verifierAvoirsCollecte', () => {
  it('signale un débit sur un compte de TVA collectée', () => {
    const ecriture = construireEcriture({
      ligneTva: { ...construireEcriture().ligneTva, compte: '445711', debit: 49.08, credit: 0 },
    });
    const anomalies = verifierAvoirsCollecte([ecriture]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('avoir_a_verifier');
    expect(anomalies[0]?.gravite).toBe('signale'); // jamais bloquant : ne peut pas être confirmé sans la pièce
  });

  it('ne signale rien sur le cas réel ROUSSEAU (crédit normal, pas de débit)', () => {
    const anomalies = verifierAvoirsCollecte([construireEcriture()]);
    expect(anomalies).toEqual([]);
  });
});

describe('executerPreControles — intégration des trois contrôles', () => {
  it('ne remonte aucune anomalie sur une écriture réelle propre (ROUSSEAU)', () => {
    const anomalies = executerPreControles([construireEcriture()]);
    expect(anomalies).toEqual([]);
  });

  it('cumule les anomalies de plusieurs contrôles sur un jeu d’écritures mixte', () => {
    const ecritureAvoir = construireEcriture({
      ledgerEntryId: 1,
      ligneTva: { ...construireEcriture().ligneTva, ledgerEntryId: 1, debit: 10, credit: 0 },
    });
    const ecritureAutoliquidationSeule = construireEcriture({
      ledgerEntryId: 2,
      ligneTva: { ...construireEcriture().ligneTva, compte: '4454', ledgerEntryId: 2, credit: 100, debit: 0 },
      autresLignes: [],
    });

    const anomalies = executerPreControles([ecritureAvoir, ecritureAutoliquidationSeule]);

    const types = anomalies.map((a) => a.type).sort();
    expect(types).toContain('avoir_a_verifier');
    expect(types).toContain('autoliquidation_desequilibree');
  });
});
