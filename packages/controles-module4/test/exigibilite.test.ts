import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { determinerExigibiliteTva, type ConfigExigibiliteTva } from '../src/exigibilite.js';

const configReelle: ConfigExigibiliteTva = {
  comptesVenteService: ['706', '704'],
};

// Cas réel ROUSSEAU (déjà validé bout-en-bout dans le connecteur) : vente de
// service (706), ligne tiers 411ROUSSEAU réellement lettrée dans le sandbox.
function ecritureRousseau(overrides: Partial<EcritureTvaComplete> = {}): EcritureTvaComplete {
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
    autresLignes: [
      { id: 92522389352448, compte: '7061', compteId: 12028930121728, libelle: null, debit: 0, credit: 3555.14 },
    ],
    lignesTiers: [
      {
        compte: '411ROUSSEAU',
        compteId: 12028930322432,
        debit: 4266.17,
        credit: 0,
        libelleCompte: 'CLIENT ROUSSEAU',
        lettrage: { estLettree: true, groupeIds: [92522390130688, 92522389336064] }, // cas réel confirmé
      },
    ],
    ...overrides,
  };
}

describe('determinerExigibiliteTva — cas réel ROUSSEAU (service, lettré)', () => {
  it('classe en service et exigible=true, cohérent avec le vrai lettrage capturé', () => {
    const { statuts, anomalies } = determinerExigibiliteTva([ecritureRousseau()], configReelle);

    expect(anomalies).toEqual([]);
    expect(statuts).toHaveLength(1);
    expect(statuts[0]).toMatchObject({
      natureOperation: 'service',
      exigible: true,
    });
  });

  it('passe à exigible=false si la même facture n’était pas encore payée', () => {
    const ecriture = ecritureRousseau({
      lignesTiers: [
        { ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: false, groupeIds: [] } },
      ],
    });
    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);

    expect(anomalies).toEqual([]);
    expect(statuts[0]?.exigible).toBe(false);
    expect(statuts[0]?.motif).toContain('pas encore exigible');
  });
});

describe('determinerExigibiliteTva — déductible, hors scope depuis le 04/08', () => {
  it('ne produit ni statut ni anomalie pour une ligne déductible (44566) — corrigée en bloc ailleurs désormais', () => {
    const ecriture = ecritureRousseau({
      ligneTva: { ...ecritureRousseau().ligneTva, compte: '44566', credit: 0, debit: 100 },
      autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        { ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: false, groupeIds: [] } },
      ],
    });

    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);
    expect(statuts).toEqual([]);
    expect(anomalies).toEqual([]);
  });

  it('idem pour un compte 44562 (immobilisations)', () => {
    const ecriture = ecritureRousseau({
      ligneTva: { ...ecritureRousseau().ligneTva, compte: '44562', credit: 0, debit: 200 },
    });

    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);
    expect(statuts).toEqual([]);
    expect(anomalies).toEqual([]);
  });
});

describe('determinerExigibiliteTva — cas d’anomalie', () => {
  it('signale une nature indéterminée si autresLignes est vide', () => {
    const ecriture = ecritureRousseau({ autresLignes: [] });
    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('nature_operation_indeterminee');
    expect(statuts[0]?.natureOperation).toBe('indetermine');
  });

  it('signale une nature mixte si la pièce touche des comptes bien ET service', () => {
    const ecriture = ecritureRousseau({
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 }, // service
        { id: 2, compte: '701', compteId: 2, libelle: null, debit: 0, credit: 500 }, // bien
      ],
    });
    const { anomalies } = determinerExigibiliteTva([ecriture], configReelle);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('nature_operation_mixte');
  });

  it('signale une ligne tiers introuvable sur une pièce de service', () => {
    const ecriture = ecritureRousseau({ lignesTiers: [] });
    const { anomalies, statuts } = determinerExigibiliteTva([ecriture], configReelle);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('ligne_tiers_introuvable');
    expect(statuts[0]?.exigible).toBe(true); // par défaut, à vérifier manuellement
  });

  it('signale un paiement partiel possible si le groupe de lettrage a plus de 2 lignes', () => {
    const ecriture = ecritureRousseau({
      lignesTiers: [
        {
          ...ecritureRousseau().lignesTiers[0]!,
          lettrage: { estLettree: true, groupeIds: [1, 2, 3] },
        },
      ],
    });
    const { anomalies, statuts } = determinerExigibiliteTva([ecriture], configReelle);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('paiement_partiel_a_verifier');
    expect(anomalies[0]?.gravite).toBe('signale');
    // Le compte affiché sur l'anomalie (`compte`) est le compte TVA, pas le
    // compte tiers concerné par le lettrage — sans ce champ, impossible de
    // savoir quel compte client/fournisseur aller vérifier dans Pennylane.
    expect(anomalies[0]?.details).toMatchObject({ compteTiers: ecriture.lignesTiers[0]!.compte });
    expect(statuts[0]?.exigible).toBe(true); // lettrée quand même, juste à vérifier le montant exact
  });

  it('ignore les comptes autoliquidation (4454/445664), hors scope de ce contrôle', () => {
    const ecriture = ecritureRousseau({
      ligneTva: { ...ecritureRousseau().ligneTva, compte: '4454' },
    });
    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);
    expect(statuts).toEqual([]);
    expect(anomalies).toEqual([]);
  });
});
