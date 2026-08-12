import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete, ContexteDossier } from '@tva-controle/core';
import { verifierDeductibiliteVehiculeTourisme } from '../src/vehiculeTourisme.js';

function ecriture(compte: string, ledgerEntryId: number, debit = 5000): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte,
      compteId: 1,
      libelle: 'Achat véhicule',
      debit,
      credit: 0,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [],
    lignesTiers: [],
  };
}

function contexte(parcVehicules: ContexteDossier['parcVehicules'] = []): ContexteDossier {
  return { tauxHistorique: [], conventions: [], parcVehicules, tiersConnus: [] };
}

describe('verifierDeductibiliteVehiculeTourisme', () => {
  it('ne signale rien si le dossier n’a aucun véhicule de tourisme', () => {
    const e = ecriture('44562', 1);
    expect(
      verifierDeductibiliteVehiculeTourisme([e], contexte([{ type: 'vehicule_utilitaire' }]))
    ).toEqual([]);
  });

  it('signale chaque ligne 44562 dès qu’un véhicule de tourisme est enregistré', () => {
    const ecritures = [ecriture('44562', 1), ecriture('44562', 2)];
    const anomalies = verifierDeductibiliteVehiculeTourisme(ecritures, contexte([{ type: 'vehicule_tourisme' }]));
    expect(anomalies).toHaveLength(2);
    expect(anomalies[0]?.type).toBe('immobilisation_vehicule_tourisme_a_verifier');
    expect(anomalies[0]?.gravite).toBe('signale');
  });

  it('ignore les lignes hors 44562 (ex: 44566 déductible ABS)', () => {
    const e = ecriture('44566', 1);
    expect(
      verifierDeductibiliteVehiculeTourisme([e], contexte([{ type: 'vehicule_tourisme' }]))
    ).toEqual([]);
  });

  it('signale même avec une flotte mixte (tourisme + utilitaire) — le doute suffit', () => {
    const e = ecriture('44562', 1);
    const anomalies = verifierDeductibiliteVehiculeTourisme(
      [e],
      contexte([{ type: 'vehicule_tourisme' }, { type: 'vehicule_utilitaire' }])
    );
    expect(anomalies).toHaveLength(1);
  });
});
