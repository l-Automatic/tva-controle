import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete, ContexteDossier } from '@tva-controle/core';
import { verifierNouveauxTiers } from '../src/tiersReference.js';

function ecriture(overrides: Partial<EcritureTvaComplete> = {}): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: '445711',
      compteId: 1,
      libelle: null,
      debit: 0,
      credit: 100,
      date: '2025-01-15',
      ledgerEntryId: 1,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    lignesTiers: [],
    autresLignes: [],
    ...overrides,
  };
}

function contexte(overrides: Partial<ContexteDossier> = {}): ContexteDossier {
  return { tauxHistorique: [], conventions: [], parcVehicules: [], ...overrides };
}

describe('verifierNouveauxTiers', () => {
  it('signale un tiers absent de tiersConnus', () => {
    const e = ecriture({
      lignesTiers: [
        {
          compte: '411ROUSSEAU',
          compteId: 1,
          libelleCompte: 'CLIENT ROUSSEAU',
          debit: 120,
          credit: 0,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });

    const { statuts, anomalies } = verifierNouveauxTiers([e], contexte({ tiersConnus: [] }));

    expect(statuts).toEqual([
      { ledgerEntryId: 1, numeroCompteTiers: '411ROUSSEAU', nomTiers: 'CLIENT ROUSSEAU', estNouveau: true },
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      type: 'nouveau_tiers_a_verifier',
      gravite: 'signale',
      compte: '411ROUSSEAU',
      details: { nomTiers: 'CLIENT ROUSSEAU' },
    });
  });

  it('ne signale rien pour un tiers déjà connu', () => {
    const e = ecriture({
      lignesTiers: [
        {
          compte: '411ROUSSEAU',
          compteId: 1,
          libelleCompte: 'CLIENT ROUSSEAU',
          debit: 120,
          credit: 0,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });

    const { statuts, anomalies } = verifierNouveauxTiers([e], contexte({ tiersConnus: ['411ROUSSEAU'] }));

    expect(statuts[0]?.estNouveau).toBe(false);
    expect(anomalies).toHaveLength(0);
  });

  it('ne compte qu’une fois un même tiers apparaissant sur plusieurs écritures', () => {
    const ligneTiers = {
      compte: '401FOURNISSEUR',
      compteId: 2,
      libelleCompte: 'FOURNISSEUR X',
      debit: 0,
      credit: 100,
      lettrage: { estLettree: false, groupeIds: [] },
    };
    const ecritures = [
      ecriture({ ledgerEntryId: 1, lignesTiers: [ligneTiers] }),
      ecriture({ ledgerEntryId: 2, lignesTiers: [ligneTiers] }),
    ];

    const { statuts, anomalies } = verifierNouveauxTiers(ecritures, contexte({ tiersConnus: [] }));

    expect(statuts).toHaveLength(1);
    expect(anomalies).toHaveLength(1);
  });

  it('tiersConnus absent (dossier tout juste onboardé) : tout est considéré nouveau', () => {
    const e = ecriture({
      lignesTiers: [
        {
          compte: '401X',
          compteId: 1,
          libelleCompte: null,
          debit: 0,
          credit: 50,
          lettrage: { estLettree: false, groupeIds: [] },
        },
      ],
    });

    const { anomalies } = verifierNouveauxTiers([e], contexte()); // pas de tiersConnus du tout

    expect(anomalies).toHaveLength(1);
  });

  it('aucune ligne tiers sur aucune écriture : aucune anomalie', () => {
    const { statuts, anomalies } = verifierNouveauxTiers([ecriture()], contexte({ tiersConnus: [] }));
    expect(statuts).toHaveLength(0);
    expect(anomalies).toHaveLength(0);
  });
});
