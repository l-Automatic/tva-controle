import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete, ContexteDossier } from '@tva-controle/core';
import { determinerDeductibiliteCarburant } from '../src/carburant.js';

const config = { comptesCarburant: ['6061'] };

function ecritureCarburant(): EcritureTvaComplete {
  return {
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
    autresLignes: [{ id: 1, compte: '6061', compteId: 1, libelle: null, debit: 100, credit: 0 }],
    lignesTiers: [],
  };
}

function contexte(overrides: Partial<ContexteDossier> = {}): ContexteDossier {
  return { tauxHistorique: [], conventions: [], parcVehicules: [], ...overrides };
}

describe('determinerDeductibiliteCarburant', () => {
  it('100% déductible si la flotte est homogène utilitaire', () => {
    const ctx = contexte({ parcVehicules: [{ type: 'vehicule_utilitaire' }] });
    const { statuts, anomalies } = determinerDeductibiliteCarburant([ecritureCarburant()], config, ctx);
    expect(anomalies).toEqual([]);
    expect(statuts[0]?.tauxDeductible).toBe(100);
  });

  it('80% déductible si la flotte est homogène tourisme', () => {
    const ctx = contexte({ parcVehicules: [{ type: 'vehicule_tourisme' }] });
    const { statuts, anomalies } = determinerDeductibiliteCarburant([ecritureCarburant()], config, ctx);
    expect(anomalies).toEqual([]);
    expect(statuts[0]?.tauxDeductible).toBe(80);
  });

  it('indéterminable et signalé si la flotte est mixte', () => {
    const ctx = contexte({
      parcVehicules: [{ type: 'vehicule_tourisme' }, { type: 'vehicule_utilitaire' }],
    });
    const { statuts, anomalies } = determinerDeductibiliteCarburant([ecritureCarburant()], config, ctx);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('flotte_mixte_carburant');
    expect(anomalies[0]?.gravite).toBe('signale'); // jamais bloquant : décision humaine
    expect(statuts[0]?.tauxDeductible).toBeNull();
  });

  it('indéterminable et signalé si aucun véhicule n’est répertorié', () => {
    const ctx = contexte({ parcVehicules: [] });
    const { statuts, anomalies } = determinerDeductibiliteCarburant([ecritureCarburant()], config, ctx);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('parc_vehicules_non_renseigne');
    expect(statuts[0]?.tauxDeductible).toBeNull();
  });

  it('ignore les types "autre" dans le parc (ni tourisme ni utilitaire)', () => {
    const ctx = contexte({ parcVehicules: [{ type: 'autre' }, { type: 'vehicule_utilitaire' }] });
    const { statuts, anomalies } = determinerDeductibiliteCarburant([ecritureCarburant()], config, ctx);
    expect(anomalies).toEqual([]);
    expect(statuts[0]?.tauxDeductible).toBe(100);
  });

  it('ignore les écritures sans ligne carburant', () => {
    const e: EcritureTvaComplete = {
      ...ecritureCarburant(),
      autresLignes: [{ id: 1, compte: '607', compteId: 1, libelle: null, debit: 100, credit: 0 }],
    };
    const ctx = contexte({ parcVehicules: [{ type: 'vehicule_utilitaire' }] });
    const { statuts, anomalies } = determinerDeductibiliteCarburant([e], config, ctx);
    expect(statuts).toEqual([]);
    expect(anomalies).toEqual([]);
  });
});
