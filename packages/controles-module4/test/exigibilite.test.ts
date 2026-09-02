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
  it('aucune ligne produit/charge (collecte) : gérée silencieusement, exigible par défaut (10/08 — plus de signalement, quasi jamais rencontré en pratique)', () => {
    const ecriture = ecritureRousseau({ autresLignes: [] });
    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);

    expect(anomalies).toHaveLength(0);
    expect(statuts[0]?.natureOperation).toBe('indetermine');
    expect(statuts[0]?.exigible).toBe(true);
  });

  it('aucune ligne produit/charge sur un compte déductible : jamais déduit par défaut, toujours silencieux', () => {
    const ecriture = ecritureRousseau({
      ligneTva: { ...ecritureRousseau().ligneTva, compte: '44566', credit: 0, debit: 100 },
      autresLignes: [],
    });
    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);

    expect(anomalies).toHaveLength(0);
    expect(statuts[0]?.natureOperation).toBe('indetermine');
    expect(statuts[0]?.exigible).toBe(false); // jamais true, côté achats
  });

  it('nature mixte, payée : TVA exigible en totalité malgré le mélange bien/service (10/08 — désormais calculé, plus juste signalé)', () => {
    const ecriture = ecritureRousseau({
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 }, // service
        { id: 2, compte: '701', compteId: 2, libelle: null, debit: 0, credit: 500 }, // bien
      ],
      // lignesTiers par défaut du fixture : lettrée (cas réel confirmé) — donc payée
    });
    const { anomalies, statuts } = determinerExigibiliteTva([ecriture], configReelle);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('nature_operation_mixte');
    expect(anomalies[0]?.gravite).toBe('info');
    expect(statuts[0]?.exigible).toBe(true);
    expect(statuts[0]?.prorataExigible).toBeUndefined(); // 100%, pas besoin d'un prorata partiel
  });

  it('nature mixte, NON payée : seule la part bien est exigible, au prorata des montants HT', () => {
    const ecriture = ecritureRousseau({
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 }, // service — 2/3
        { id: 2, compte: '701', compteId: 2, libelle: null, debit: 0, credit: 500 }, // bien — 1/3
      ],
      lignesTiers: [
        { ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: false, groupeIds: [] } },
      ],
    });
    const { anomalies, statuts } = determinerExigibiliteTva([ecriture], configReelle);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.gravite).toBe('info');
    expect(statuts[0]?.exigible).toBe(true); // > 0, donc pas totalement exclu
    expect(statuts[0]?.prorataExigible).toBeCloseTo(1 / 3); // 500 / (1000 + 500)
  });

  it('nature mixte, vente comptant sans ligne tiers : traitée comme payée, exigible en totalité', () => {
    const ecriture = ecritureRousseau({
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 },
        { id: 2, compte: '701', compteId: 2, libelle: null, debit: 0, credit: 500 },
      ],
      lignesTiers: [],
    });
    const { statuts } = determinerExigibiliteTva([ecriture], configReelle);
    expect(statuts[0]?.exigible).toBe(true);
    expect(statuts[0]?.prorataExigible).toBeUndefined();
  });

  it('624 (livraison) assimilé au bien même s’il matcherait un préfixe service du dossier — jamais exclu par le prorata (10/08)', () => {
    const ecriture = ecritureRousseau({
      autresLignes: [{ id: 1, compte: '624100', compteId: 1, libelle: null, debit: 0, credit: 300 }],
      lignesTiers: [
        { ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: false, groupeIds: [] } },
      ],
    });
    // Un seul compte, donc classification simple (pas nature_operation_mixte) —
    // vérifie que 624 est bien classé "bien", jamais "service" malgré le non-paiement.
    const { statuts, anomalies } = determinerExigibiliteTva([ecriture], configReelle);
    expect(anomalies).toEqual([]);
    expect(statuts[0]?.natureOperation).toBe('bien');
    expect(statuts[0]?.exigible).toBe(true);
  });

  it('6222 (commissions et courtages) assimilé au bien — même non payé, la part correspondante reste exigible dans une pièce mixte', () => {
    const ecriture = ecritureRousseau({
      autresLignes: [
        { id: 1, compte: '7061', compteId: 1, libelle: null, debit: 0, credit: 1000 }, // vrai service
        { id: 2, compte: '622200', compteId: 2, libelle: null, debit: 0, credit: 500 }, // assimilé bien
      ],
      lignesTiers: [
        { ...ecritureRousseau().lignesTiers[0]!, lettrage: { estLettree: false, groupeIds: [] } },
      ],
    });
    const { statuts } = determinerExigibiliteTva([ecriture], configReelle);
    // 500 (6222, assimilé bien) / 1500 total = 1/3 exigible, malgré le non-paiement
    expect(statuts[0]?.prorataExigible).toBeCloseTo(1 / 3);
  });

  it('un compte 622 générique (hors 6222) reste soumis à la convention dossier normale, pas assimilé au bien', () => {
    const ecriture = ecritureRousseau({
      autresLignes: [{ id: 1, compte: '622100', compteId: 1, libelle: null, debit: 0, credit: 300 }],
    });
    // 622100 ne matche ni comptesVenteService (706/704) ni PREFIXES_ASSIMILES_BIEN (624/6222) -> bien par défaut
    const { statuts } = determinerExigibiliteTva([ecriture], configReelle);
    expect(statuts[0]?.natureOperation).toBe('bien');
  });

  it('vente comptant sans ligne tiers (caisse) : exigible sans être signalée (10/08, retiré après discussion avec Rami)', () => {
    const ecriture = ecritureRousseau({ lignesTiers: [] });
    const { anomalies, statuts } = determinerExigibiliteTva([ecriture], configReelle);

    expect(anomalies).toEqual([]);
    expect(statuts[0]?.exigible).toBe(true);
    expect(statuts[0]?.motif).toContain('vente comptant');
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
    expect(anomalies).toEqual([]); // aucune ligne tiers, mais plus signalé (vente comptant)
  });

  it('sans la convention comptesPaiementComptant, retombe sur le comportement "vente comptant sans ligne tiers" (10/08)', () => {
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

    const { anomalies, statuts } = determinerExigibiliteTva([e], {
      ...configReelle,
      comptesChargeService: ['6251'],
      // comptesPaiementComptant absent
    });
    expect(anomalies).toEqual([]);
    expect(statuts[0]?.exigible).toBe(true);
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
