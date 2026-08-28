import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { determinerExigibiliteTva, type ConfigExigibiliteTva } from '../src/exigibilite.js';

const configReelle: ConfigExigibiliteTva = {
  comptesVenteService: ['706', '704'],
  comptesChargeService: ['611'],
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

describe('determinerExigibiliteTva — biens (déductible dès facturation)', () => {
  it('un achat de bien (607, hors liste service) est exigible même sans lettrage', () => {
    const ecriture = ecritureRousseau({
      ligneTva: { ...ecritureRousseau().ligneTva, compte: '44566', credit: 0, debit: 100 },
      autresLignes: [{ id: 1, compte: '607', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        { ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: false, groupeIds: [] } },
      ],
    });

    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);
    expect(anomalies).toEqual([]);
    expect(statuts[0]).toMatchObject({ natureOperation: 'bien', exigible: true });
  });

  it('un achat de service (611, sous-traitance) suit l’exigibilité du lettrage', () => {
    const ecriture = ecritureRousseau({
      ligneTva: { ...ecritureRousseau().ligneTva, compte: '44566', credit: 0, debit: 100 },
      autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        { ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: false, groupeIds: [] } },
      ],
    });

    const { statuts } = determinerExigibiliteTva([ecriture], configReelle);
    expect(statuts[0]).toMatchObject({ natureOperation: 'service', exigible: false });
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
    expect(statuts[0]?.exigible).toBe(true); // lettrée quand même, juste à vérifier le montant exact
  });

  it('applique le prorata calculé quand fourni (10/08) — remplace le signalement manuel par un calcul', () => {
    const ecriture = ecritureRousseau({
      lignesTiers: [
        {
          ...ecritureRousseau().lignesTiers[0]!,
          lettrage: { estLettree: true, groupeIds: [1, 2, 3] },
        },
      ],
    });
    const prorataParEcriture = new Map([[ecriture.ligneTva.ledgerEntryId, 0.6]]);
    const { anomalies, statuts } = determinerExigibiliteTva([ecriture], configReelle, prorataParEcriture);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('paiement_partiel_calcule');
    expect(anomalies[0]?.gravite).toBe('info'); // plus "à vérifier", c'est calculé
    expect(statuts[0]?.exigible).toBe(true);
    expect(statuts[0]?.prorataExigible).toBe(0.6);
  });

  it('prorata calculé à 0 : exigible false, rien à inclure cette période', () => {
    const ecriture = ecritureRousseau({
      lignesTiers: [
        {
          ...ecritureRousseau().lignesTiers[0]!,
          lettrage: { estLettree: true, groupeIds: [1, 2, 3] },
        },
      ],
    });
    const prorataParEcriture = new Map([[ecriture.ligneTva.ledgerEntryId, 0]]);
    const { statuts } = determinerExigibiliteTva([ecriture], configReelle, prorataParEcriture);
    expect(statuts[0]?.exigible).toBe(false);
    expect(statuts[0]?.prorataExigible).toBe(0);
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

describe('determinerExigibiliteTva — comptes toujours payés au comptant (10/08)', () => {
  it('exigible sans jamais vérifier le lettrage, même non lettré', () => {
    const e: EcritureTvaComplete = {
      ledgerEntryId: 1,
      ligneTva: {
        id: 1,
        compte: '44566',
        compteId: 1,
        libelle: 'Péage A6',
        debit: 20,
        credit: 0,
        date: '2025-01-15',
        ledgerEntryId: 1,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [{ id: 1, compte: '6251', compteId: 1, libelle: null, debit: 100, credit: 0 }],
      lignesTiers: [], // volontairement vide : le lettrage ne doit même pas être regardé
    };

    const { statuts, anomalies } = determinerExigibiliteTva([e], {
      ...configReelle,
      comptesPaiementComptant: ['6251'],
    });

    expect(statuts).toEqual([
      {
        ledgerEntryId: 1,
        compte: '44566',
        natureOperation: 'service',
        exigible: true,
        motif: 'Compte systématiquement payé au comptant (frais de déplacement, postaux, bancaires...) : exigible sans vérification de lettrage.',
      },
    ]);
    expect(anomalies).toEqual([]); // pas de "ligne_tiers_introuvable" malgré lignesTiers vide
  });

  it('sans la convention configurée, le comportement habituel (ligne_tiers_introuvable) reprend le dessus', () => {
    const e: EcritureTvaComplete = {
      ledgerEntryId: 1,
      ligneTva: {
        id: 1,
        compte: '44566',
        compteId: 1,
        libelle: null,
        debit: 20,
        credit: 0,
        date: '2025-01-15',
        ledgerEntryId: 1,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [{ id: 1, compte: '6251', compteId: 1, libelle: null, debit: 100, credit: 0 }],
      lignesTiers: [],
    };

    const { anomalies } = determinerExigibiliteTva([e], {
      ...configReelle,
      comptesChargeService: ['6251'],
      // comptesPaiementComptant absent
    });
    expect(anomalies.some((a) => a.type === 'ligne_tiers_introuvable')).toBe(true);
  });
});

describe('determinerExigibiliteTva — prudence inversée achats vs ventes sur groupe ambigu (10/08)', () => {
  function ecritureAchatGroupeAmbigu(): EcritureTvaComplete {
    return {
      ledgerEntryId: 1,
      ligneTva: {
        id: 1,
        compte: '44566',
        compteId: 1,
        libelle: null,
        debit: 100,
        credit: 0,
        date: '2025-01-15',
        ledgerEntryId: 1,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        {
          compte: '401DUPONT',
          compteId: 1,
          libelleCompte: 'FOURNISSEUR DUPONT',
          debit: 0,
          credit: 600,
          lettrage: { estLettree: true, groupeIds: [1, 2, 3] }, // lettré, mais groupe ambigu
        },
      ],
    };
  }

  it('achat : sans prorata calculé, exclut par prudence même si le groupe est "lettré"', () => {
    const { statuts, anomalies } = determinerExigibiliteTva([ecritureAchatGroupeAmbigu()], configReelle);
    expect(statuts[0]?.exigible).toBe(false);
    expect(statuts[0]?.motif).toContain('Achat');
    expect(statuts[0]?.motif).toContain('pas de déduction');
    expect(anomalies.some((a) => a.type === 'paiement_partiel_a_verifier')).toBe(true);
  });

  it('achat : avec un prorata calculé (LLM ayant établi le lien), applique le prorata normalement', () => {
    const prorataParEcriture = new Map([[1, 0.4]]);
    const { statuts } = determinerExigibiliteTva([ecritureAchatGroupeAmbigu()], configReelle, prorataParEcriture);
    expect(statuts[0]?.exigible).toBe(true);
    expect(statuts[0]?.prorataExigible).toBe(0.4);
  });

  it('vente : sans prorata calculé sur un groupe ambigu, reste exigible par prudence (comportement historique inchangé)', () => {
    const e = ecritureRousseau({
      lignesTiers: [{ ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: true, groupeIds: [1, 2, 3] } }],
    });
    const { statuts } = determinerExigibiliteTva([e], configReelle);
    expect(statuts[0]?.exigible).toBe(true);
  });

  it('applique le prorata même sur une facture TOTALEMENT non lettrée (bug réel corrigé le 10/08 : le contrôle était enfoui dans le bloc groupeIds > 2, jamais consulté sinon)', () => {
    const e: EcritureTvaComplete = {
      ledgerEntryId: 1,
      ligneTva: {
        id: 1,
        compte: '44566',
        compteId: 1,
        libelle: null,
        debit: 100,
        credit: 0,
        date: '2025-01-15',
        ledgerEntryId: 1,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [{ id: 1, compte: '611', compteId: 1, libelle: null, debit: 500, credit: 0 }],
      lignesTiers: [
        {
          compte: '401DIVERS',
          compteId: 1,
          libelleCompte: null,
          debit: 0,
          credit: 600,
          lettrage: { estLettree: false, groupeIds: [] }, // aucun lettrage du tout
        },
      ],
    };
    const prorataParEcriture = new Map([[1, 0.5]]);
    const { statuts, anomalies } = determinerExigibiliteTva([e], configReelle, prorataParEcriture);

    expect(statuts[0]?.exigible).toBe(true);
    expect(statuts[0]?.prorataExigible).toBe(0.5);
    expect(anomalies[0]?.type).toBe('paiement_partiel_calcule');
  });

  it('un compte "paiement comptant" (625) reste toujours exigible normalement pour un péage, sans exception', () => {
    const e: EcritureTvaComplete = {
      ledgerEntryId: 5,
      ligneTva: {
        id: 5,
        compte: '44566',
        compteId: 1,
        libelle: 'PEAGE A6',
        debit: 20,
        credit: 0,
        date: '2025-01-15',
        ledgerEntryId: 5,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [{ id: 1, compte: '6251', compteId: 1, libelle: null, debit: 100, credit: 0 }],
      lignesTiers: [],
    };
    const { statuts } = determinerExigibiliteTva([e], { ...configReelle, comptesPaiementComptant: ['6251'] });
    expect(statuts[0]?.exigible).toBe(true);
    expect(statuts[0]?.motif).toContain('payé au comptant');
  });

  it('un hôtel (625) marqué en exception suit la logique normale de prorata au lieu du court-circuit comptant (10/08)', () => {
    const e: EcritureTvaComplete = {
      ledgerEntryId: 6,
      ligneTva: {
        id: 6,
        compte: '44566',
        compteId: 1,
        libelle: 'HOTEL IBIS',
        debit: 20,
        credit: 0,
        date: '2025-01-15',
        ledgerEntryId: 6,
        lettrage: { estLettree: false, groupeIds: [] },
      },
      autresLignes: [{ id: 1, compte: '6251', compteId: 1, libelle: null, debit: 100, credit: 0 }],
      lignesTiers: [
        {
          compte: '401DIVERS',
          compteId: 1,
          libelleCompte: null,
          debit: 0,
          credit: 100,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    };
    const prorataParEcriture = new Map([[6, 0.5]]);
    const { statuts } = determinerExigibiliteTva(
      [e],
      { ...configReelle, comptesPaiementComptant: ['6251'] },
      prorataParEcriture,
      new Set([6]) // exception hôtel
    );
    // Le prorata s'applique, pas le court-circuit "payé au comptant"
    expect(statuts[0]?.prorataExigible).toBe(0.5);
    expect(statuts[0]?.motif).not.toContain('payé au comptant');
  });
});
