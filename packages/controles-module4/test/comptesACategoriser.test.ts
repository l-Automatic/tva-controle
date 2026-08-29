import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { identifierComptesACategoriser, identifierComptesServiceSansSousCategorieAutoliquidation } from '../src/comptesACategoriser.js';

function ecriture(autresLignes: EcritureTvaComplete['autresLignes']): EcritureTvaComplete {
  return {
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
    lignesTiers: [],
    autresLignes,
  };
}

const connusVides = { comptesVenteService: [], comptesChargeService: [], comptesEquipement: [], comptesCarburant: [] };

describe('identifierComptesACategoriser', () => {
  it('signale un compte produit jamais catégorisé nulle part', () => {
    const e = ecriture([{ id: 1, compte: '706100', compteId: 1, libelle: 'Vente prestation', debit: 0, credit: 100 }]);

    const resultat = identifierComptesACategoriser([e], connusVides);

    expect(resultat).toEqual([{ compte: '706100', exemplesLibelle: ['Vente prestation'] }]);
  });

  it('ignore un compte déjà couvert par un préfixe connu', () => {
    const e = ecriture([{ id: 1, compte: '706100', compteId: 1, libelle: null, debit: 0, credit: 100 }]);
    const connus = { ...connusVides, comptesVenteService: ['706'] };

    expect(identifierComptesACategoriser([e], connus)).toEqual([]);
  });

  it('regroupe plusieurs occurrences du même compte, limite à 3 libellés d’exemple', () => {
    const ecritures = [
      ecriture([{ id: 1, compte: '604', compteId: 1, libelle: 'Achat A', debit: 100, credit: 0 }]),
      ecriture([{ id: 2, compte: '604', compteId: 1, libelle: 'Achat B', debit: 200, credit: 0 }]),
      ecriture([{ id: 3, compte: '604', compteId: 1, libelle: 'Achat C', debit: 300, credit: 0 }]),
      ecriture([{ id: 4, compte: '604', compteId: 1, libelle: 'Achat D', debit: 400, credit: 0 }]),
    ];

    const resultat = identifierComptesACategoriser(ecritures, connusVides);

    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.compte).toBe('604');
    expect(resultat[0]?.exemplesLibelle).toHaveLength(3);
  });

  it('distingue plusieurs comptes différents, triés par numéro', () => {
    const ecritures = [
      ecriture([{ id: 1, compte: '607', compteId: 1, libelle: null, debit: 100, credit: 0 }]),
      ecriture([{ id: 2, compte: '604', compteId: 1, libelle: null, debit: 100, credit: 0 }]),
    ];

    const resultat = identifierComptesACategoriser(ecritures, connusVides);
    expect(resultat.map((r) => r.compte)).toEqual(['604', '607']);
  });

  it('aucune ligne autre : liste vide', () => {
    expect(identifierComptesACategoriser([ecriture([])], connusVides)).toEqual([]);
  });

  it('exclut un compte de trésorerie (5121) — bug réel du 08/08, ne concerne pas ce popup', () => {
    const e = ecriture([
      { id: 1, compte: '5121', compteId: 1, libelle: 'Virement', debit: 500, credit: 0 },
      { id: 2, compte: '607', compteId: 2, libelle: 'Achat marchandises', debit: 100, credit: 0 },
    ]);

    const resultat = identifierComptesACategoriser([e], connusVides);
    expect(resultat.map((r) => r.compte)).toEqual(['607']);
  });

  it('exclut aussi les comptes tiers (4xx) qui pourraient se retrouver dans autresLignes', () => {
    const e = ecriture([{ id: 1, compte: '401FOURNISSEUR', compteId: 1, libelle: null, debit: 0, credit: 200 }]);

    expect(identifierComptesACategoriser([e], connusVides)).toEqual([]);
  });
});

describe('identifierComptesServiceSansSousCategorieAutoliquidation', () => {
  it('signale un compte charge service pas encore marqué autoliquidation', () => {
    const e = ecriture([
      { id: 1, compte: '604AUTOLIQ', compteId: 1, libelle: 'Sous-traitance autoliquidée', debit: 500, credit: 0 },
    ]);
    const resultat = identifierComptesServiceSansSousCategorieAutoliquidation(
      [e],
      ['604', '611'],
      []
    );
    expect(resultat).toEqual([{ compte: '604AUTOLIQ', exemplesLibelle: ['Sous-traitance autoliquidée'] }]);
  });

  it('ignore un compte déjà marqué autoliquidation', () => {
    const e = ecriture([{ id: 1, compte: '604AUTOLIQ', compteId: 1, libelle: null, debit: 500, credit: 0 }]);
    const resultat = identifierComptesServiceSansSousCategorieAutoliquidation(
      [e],
      ['604'],
      ['604AUTOLIQ']
    );
    expect(resultat).toEqual([]);
  });

  it('ne re-propose plus un compte explicitement rejeté (10/08, bug réel corrigé)', () => {
    const e = ecriture([{ id: 1, compte: '6155', compteId: 1, libelle: 'GARAGE DUPONT', debit: 500, credit: 0 }]);
    const resultat = identifierComptesServiceSansSousCategorieAutoliquidation(
      [e],
      ['615'],
      [],
      ['6155'] // rejeté explicitement
    );
    expect(resultat).toEqual([]);
  });

  it('ignore un compte qui n’est même pas charge de service', () => {
    const e = ecriture([{ id: 1, compte: '607', compteId: 1, libelle: null, debit: 500, credit: 0 }]);
    expect(identifierComptesServiceSansSousCategorieAutoliquidation([e], ['604', '611'], [])).toEqual([]);
  });
});

describe('identifierComptesACategoriser — comptesSansCategorie (10/08, bug réel corrigé)', () => {
  it('ne re-propose plus un compte marqué "aucune de celles-là"', () => {
    const e = ecriture([{ id: 1, compte: '699', compteId: 1, libelle: null, debit: 500, credit: 0 }]);
    const connus = { ...connusVides, comptesSansCategorie: ['699'] };
    expect(identifierComptesACategoriser([e], connus)).toEqual([]);
  });

  it('sans comptesSansCategorie, un compte inconnu reste proposé (comportement d’avant, toujours vrai pour un compte jamais vu)', () => {
    const e = ecriture([{ id: 1, compte: '699', compteId: 1, libelle: null, debit: 500, credit: 0 }]);
    expect(identifierComptesACategoriser([e], connusVides)).toHaveLength(1);
  });
});
