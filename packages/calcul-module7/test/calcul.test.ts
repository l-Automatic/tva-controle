import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';
import type { StatutExigibilite, StatutCarburant } from '@tva-controle/controles-module4';
import { calculerTva, integrerRegularisations } from '../src/calcul.js';

function ligneTva(overrides: Partial<EcritureTvaComplete['ligneTva']> = {}): EcritureTvaComplete['ligneTva'] {
  return {
    id: 1,
    compte: '445711',
    compteId: 1,
    libelle: null,
    debit: 0,
    credit: 0,
    date: '2025-01-15',
    ledgerEntryId: 1,
    lettrage: { estLettree: false, groupeIds: [] },
    ...overrides,
  };
}

function ecriture(overrides: Partial<EcritureTvaComplete> = {}): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: ligneTva(),
    autresLignes: [],
    lignesTiers: [],
    ...overrides,
  };
}

describe('calculerTva — garde-fou anomalies bloquantes', () => {
  it('refuse de calculer si une anomalie bloquante est présente', () => {
    const anomalieBloquante: Anomalie = {
      type: 'taux_incoherent',
      gravite: 'bloquant',
      ledgerEntryId: 1,
      compte: '445711',
      description: 'test',
    };
    expect(() => calculerTva([], [anomalieBloquante], [], [])).toThrow(/bloquante/);
  });

  it('calcule normalement s’il n’y a que des anomalies signale/info', () => {
    const anomalieSignale: Anomalie = {
      type: 'avoir_a_verifier',
      gravite: 'signale',
      ledgerEntryId: 1,
      compte: '445711',
      description: 'test',
    };
    expect(() => calculerTva([], [anomalieSignale], [], [])).not.toThrow();
  });
});

describe('calculerTva — cas réel ROUSSEAU (collecte 20%, exigible)', () => {
  it('range la ligne dans collectee_20 pour le bon montant', () => {
    const e = ecriture({ ligneTva: ligneTva({ compte: '445711', credit: 711.03, ledgerEntryId: 1 }) });
    const statuts: StatutExigibilite[] = [
      { ledgerEntryId: 1, compte: '445711', natureOperation: 'service', exigible: true, motif: 'lettrée' },
    ];

    const resultat = calculerTva([e], [], statuts, []);
    expect(resultat.lignes).toEqual([{ categorie: 'collectee_20', montant: 711.03, referencesPieces: [1] }]);
    expect(resultat.tvaNette).toBe(711.03);
    expect(resultat.sens).toBe('a_decaisser');
    expect(resultat.ecrituresExclues).toEqual([]);
  });
});

describe('calculerTva — exigibilité (TVA sur encaissement)', () => {
  it('exclut une ligne de service non exigible (facture pas encore payée)', () => {
    const e = ecriture({ ligneTva: ligneTva({ compte: '445711', credit: 500, ledgerEntryId: 1 }) });
    const statuts: StatutExigibilite[] = [
      { ledgerEntryId: 1, compte: '445711', natureOperation: 'service', exigible: false, motif: 'pas encore payée' },
    ];

    const resultat = calculerTva([e], [], statuts, []);
    expect(resultat.lignes).toEqual([]);
    expect(resultat.tvaNette).toBe(0);
    expect(resultat.ecrituresExclues).toEqual([
      { ledgerEntryId: 1, compte: '445711', motif: 'pas encore payée', date: '2025-01-15' },
    ]);
  });

  it('inclut le compte tiers dans l’exclusion quand une ligne tiers est identifiée', () => {
    const e = ecriture({
      ligneTva: ligneTva({ compte: '445711', credit: 500, ledgerEntryId: 2 }),
      lignesTiers: [
        {
          compte: '411ROUSSEAU',
          compteId: 1,
          libelleCompte: 'CLIENT ROUSSEAU',
          debit: 500,
          credit: 0,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });
    const statuts: StatutExigibilite[] = [
      { ledgerEntryId: 2, compte: '445711', natureOperation: 'service', exigible: false, motif: 'pas encore payée' },
    ];

    const resultat = calculerTva([e], [], statuts, []);
    expect(resultat.ecrituresExclues).toEqual([
      { ledgerEntryId: 2, compte: '445711', motif: 'pas encore payée', date: '2025-01-15', compteTiers: '411ROUSSEAU' },
    ]);
  });
});

describe('calculerTva — déductible ABS vs IMMO', () => {
  it('sépare 44566 (abs) et 44562 (immo) en catégories distinctes', () => {
    const eAbs = ecriture({ ligneTva: ligneTva({ compte: '44566', debit: 100, ledgerEntryId: 1 }) });
    const eImmo = ecriture({ ligneTva: ligneTva({ compte: '44562', debit: 50, ledgerEntryId: 2 }) });

    const resultat = calculerTva([eAbs, eImmo], [], [], []);
    const categories = resultat.lignes.map((l) => l.categorie).sort();
    expect(categories).toEqual(['deductible_abs', 'deductible_immo']);
  });
});

describe('calculerTva — autoliquidation', () => {
  it('sépare due et déductible en lignes distinctes, et elles s’annulent dans le net', () => {
    const eDue = ecriture({ ligneTva: ligneTva({ compte: '4454', credit: 300, ledgerEntryId: 1 }) });
    const eDeductible = ecriture({ ligneTva: ligneTva({ compte: '445664', debit: 300, ledgerEntryId: 1 }) });

    const resultat = calculerTva([eDue, eDeductible], [], [], []);
    const categories = resultat.lignes.map((l) => l.categorie).sort();
    expect(categories).toEqual(['autoliquidation_deductible', 'autoliquidation_due']);
    expect(resultat.tvaNette).toBe(0);
  });

  it('extrait la TVA du montant porté sur le compte (TTC-équivalent), pas le montant brut lui-même', () => {
    // Le montant sur 4454/445664 est le TTC-équivalent facturé par le
    // fournisseur étranger, pas la TVA déjà isolée. À 20%, TVA = TTC/6,
    // pas TTC/5 (confirmé avec Rami — cf. conversation du 30/07).
    const eDue = ecriture({ ligneTva: ligneTva({ compte: '4454', credit: 1200, ledgerEntryId: 1 }) });

    const resultat = calculerTva([eDue], [], [], []);

    expect(resultat.lignes).toEqual([{ categorie: 'autoliquidation_due', montant: 200, referencesPieces: [1] }]);
  });

  it('taux configurable via tauxAutoliquidation, défaut 20%', () => {
    const eDue = ecriture({ ligneTva: ligneTva({ compte: '4454', credit: 1100, ledgerEntryId: 1 }) });

    const resultat = calculerTva([eDue], [], [], [], { tauxAutoliquidation: 10 });

    // 1100 TTC à 10% -> HT = 1000, TVA = 100
    expect(resultat.lignes).toEqual([{ categorie: 'autoliquidation_due', montant: 100, referencesPieces: [1] }]);
  });
});

describe('calculerTva — carburant', () => {
  it('réduit le montant déductible au taux calculé par le contrôle carburant', () => {
    const e = ecriture({ ligneTva: ligneTva({ compte: '44566', debit: 100, ledgerEntryId: 1 }) });
    const statutsCarburant: StatutCarburant[] = [
      { ledgerEntryId: 1, compte: '44566', tauxDeductible: 80, motif: 'flotte tourisme' },
    ];

    const resultat = calculerTva([e], [], [], statutsCarburant);
    expect(resultat.lignes).toEqual([{ categorie: 'deductible_abs', montant: 80, referencesPieces: [1] }]);
  });

  it('exclut par défaut (politique prudente) si le taux carburant est indéterminé', () => {
    const e = ecriture({ ligneTva: ligneTva({ compte: '44566', debit: 100, ledgerEntryId: 1 }) });
    const statutsCarburant: StatutCarburant[] = [
      { ledgerEntryId: 1, compte: '44566', tauxDeductible: null, motif: 'flotte mixte' },
    ];

    const resultat = calculerTva([e], [], [], statutsCarburant);
    expect(resultat.lignes).toEqual([]);
    expect(resultat.ecrituresExclues).toHaveLength(1);
  });

  it('inclut au montant plein si le taux est indéterminé mais politique="inclure"', () => {
    const e = ecriture({ ligneTva: ligneTva({ compte: '44566', debit: 100, ledgerEntryId: 1 }) });
    const statutsCarburant: StatutCarburant[] = [
      { ledgerEntryId: 1, compte: '44566', tauxDeductible: null, motif: 'flotte mixte' },
    ];

    const resultat = calculerTva([e], [], [], statutsCarburant, { politiqueIndetermine: 'inclure' });
    expect(resultat.lignes).toEqual([{ categorie: 'deductible_abs', montant: 100, referencesPieces: [1] }]);
  });
});

describe('calculerTva — taux non résolu', () => {
  it('exclut une ligne de collecte dont le compte ne correspond à aucun taux connu', () => {
    const e = ecriture({ ligneTva: ligneTva({ compte: '445715', credit: 100, ledgerEntryId: 1 }) });
    const resultat = calculerTva([e], [], [], []);
    expect(resultat.lignes).toEqual([]);
    expect(resultat.ecrituresExclues).toHaveLength(1);
  });
});

describe('calculerTva — sens du résultat', () => {
  it('retourne "credit" quand le déductible dépasse le collecté', () => {
    const eCollecte = ecriture({ ligneTva: ligneTva({ compte: '445711', credit: 100, ledgerEntryId: 1 }) });
    const eDeductible = ecriture({ ligneTva: ligneTva({ compte: '44566', debit: 500, ledgerEntryId: 2 }) });

    const resultat = calculerTva([eCollecte, eDeductible], [], [], []);
    expect(resultat.sens).toBe('credit');
    expect(resultat.tvaNette).toBe(400);
  });
});

describe('integrerRegularisations — encaissements 471 qualifiés comme vente', () => {
  it('déduit la TVA du montant TTC et l’ajoute à la bonne catégorie de taux', () => {
    const base = calculerTva([], [], [], []); // rien au départ

    const resultat = integrerRegularisations(base, [
      { ledgerEntryId: 999, montantTTC: 1200, taux: 20 },
    ]);

    // 1200 TTC à 20% -> HT = 1000, TVA = 200
    expect(resultat.lignes).toEqual([
      { categorie: 'collectee_20', montant: 200, referencesPieces: [999] },
    ]);
    expect(resultat.tvaNette).toBe(200);
    expect(resultat.sens).toBe('a_decaisser');
  });

  it('cumule avec les lignes déjà calculées de la même catégorie plutôt que de les dupliquer', () => {
    const base = calculerTva(
      [ecriture({ ligneTva: ligneTva({ compte: '445711', credit: 100, ledgerEntryId: 1 }) })],
      [],
      [],
      []
    );

    const resultat = integrerRegularisations(base, [
      { ledgerEntryId: 999, montantTTC: 120, taux: 20 }, // TVA = 20
    ]);

    const ligneCollectee = resultat.lignes.find((l) => l.categorie === 'collectee_20');
    expect(ligneCollectee?.montant).toBe(120); // 100 (existant) + 20 (régularisation)
    expect(ligneCollectee?.referencesPieces.sort()).toEqual([1, 999]);
  });

  it('ne modifie rien si la liste de régularisations est vide', () => {
    const base = calculerTva(
      [ecriture({ ligneTva: ligneTva({ compte: '445711', credit: 100, ledgerEntryId: 1 }) })],
      [],
      [],
      []
    );

    expect(integrerRegularisations(base, [])).toEqual(base);
  });

  it('refuse un taux non reconnu plutôt que de le laisser silencieusement disparaître', () => {
    const base = calculerTva([], [], [], []);

    expect(() => integrerRegularisations(base, [{ ledgerEntryId: 1, montantTTC: 100, taux: 15 }])).toThrow(
      /taux 15%/
    );
  });
});

describe('calculerTva — cadeaux clients, seuil 73€ HT (09/08, corrigé après retour de Rami)', () => {
  it('exclut totalement une ligne dont le cadeau dépasse 73€ HT', () => {
    const e = ecriture({
      ligneTva: ligneTva({ compte: '44566', debit: 100, ledgerEntryId: 1 }),
      autresLignes: [{ id: 1, compte: '623', compteId: 1, libelle: 'Cadeaux clients', debit: 500, credit: 0 }],
    });

    const resultat = calculerTva([e], [], [], [], { comptesCadeaux: ['623'] });
    expect(resultat.lignes).toEqual([]);
    expect(resultat.ecrituresExclues[0]?.motif).toContain('Cadeau client');
    expect(resultat.ecrituresExclues[0]?.motif).toContain('73');
  });

  it('déduit normalement un cadeau sous le seuil de 73€ HT', () => {
    const e = ecriture({
      ligneTva: ligneTva({ compte: '44566', debit: 12, ledgerEntryId: 1 }),
      autresLignes: [{ id: 1, compte: '623', compteId: 1, libelle: 'Petit cadeau', debit: 60, credit: 0 }],
    });

    const resultat = calculerTva([e], [], [], [], { comptesCadeaux: ['623'] });
    expect(resultat.lignes).toEqual([{ categorie: 'deductible_abs', montant: 12, referencesPieces: [1] }]);
    expect(resultat.ecrituresExclues).toEqual([]);
  });

  it('déduit normalement un cadeau exactement à 73€ HT (seuil inclus, pas exclu)', () => {
    const e = ecriture({
      ligneTva: ligneTva({ compte: '44566', debit: 14.6, ledgerEntryId: 1 }),
      autresLignes: [{ id: 1, compte: '623', compteId: 1, libelle: null, debit: 73, credit: 0 }],
    });

    const resultat = calculerTva([e], [], [], [], { comptesCadeaux: ['623'] });
    expect(resultat.ecrituresExclues).toEqual([]);
  });

  it('n’exclut pas une ligne déductible normale si comptesCadeaux ne matche pas', () => {
    const e = ecriture({
      ligneTva: ligneTva({ compte: '44566', debit: 100, ledgerEntryId: 1 }),
      autresLignes: [{ id: 1, compte: '607', compteId: 1, libelle: null, debit: 500, credit: 0 }],
    });

    const resultat = calculerTva([e], [], [], [], { comptesCadeaux: ['623'] });
    expect(resultat.lignes).toEqual([{ categorie: 'deductible_abs', montant: 100, referencesPieces: [1] }]);
  });

  it('n’affecte jamais la collecte, même si comptesCadeaux est configuré', () => {
    const e = ecriture({ ligneTva: ligneTva({ compte: '445711', credit: 200, ledgerEntryId: 1 }) });
    const resultat = calculerTva([e], [], [], [], { comptesCadeaux: ['623'] });
    expect(resultat.lignes.find((l) => l.categorie === 'collectee_20')?.montant).toBe(200);
  });
});
