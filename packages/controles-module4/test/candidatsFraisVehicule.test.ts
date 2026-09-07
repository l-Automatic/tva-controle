import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { identifierCandidatsFraisVehicule } from '../src/candidatsFraisVehicule.js';

function ecriture(overrides: {
  compte?: string;
  debit?: number;
  libelle?: string | null;
  autresLignes?: { compte: string }[];
}): EcritureTvaComplete {
  return {
    ledgerEntryId: 1,
    ligneTva: {
      id: 1,
      compte: overrides.compte ?? '44566',
      compteId: 1,
      libelle: overrides.libelle ?? 'ENTRETIEN VEHICULE',
      debit: overrides.debit ?? 0,
      credit: 0,
      date: '2025-01-15',
      ledgerEntryId: 1,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: (overrides.autresLignes ?? []).map((l, i) => ({
      id: i + 1,
      compte: l.compte,
      compteId: i + 1,
      libelle: null,
      debit: 0,
      credit: 0,
    })),
    lignesTiers: [],
  };
}

describe('identifierCandidatsFraisVehicule', () => {
  it('candidat : 44566 avec TVA déduite ET une ligne du compte concerné', () => {
    const e = ecriture({ debit: 200, autresLignes: [{ compte: '615500' }] });
    expect(identifierCandidatsFraisVehicule([e], ['615500'])).toHaveLength(1);
  });

  it('exclut si aucune TVA déduite', () => {
    const e = ecriture({ debit: 0, autresLignes: [{ compte: '615500' }] });
    expect(identifierCandidatsFraisVehicule([e], ['615500'])).toEqual([]);
  });

  it("exclut si le compte n'est pas 44566", () => {
    const e = ecriture({ compte: '44571', debit: 200, autresLignes: [{ compte: '615500' }] });
    expect(identifierCandidatsFraisVehicule([e], ['615500'])).toEqual([]);
  });

  it('exclut si aucune ligne ne touche le compte concerné', () => {
    const e = ecriture({ debit: 200, autresLignes: [{ compte: '606100' }] }); // carburant, sans rapport
    expect(identifierCandidatsFraisVehicule([e], ['615500'])).toEqual([]);
  });

  it('fonctionne identiquement pour location (autre liste de comptes)', () => {
    const e = ecriture({ debit: 200, autresLignes: [{ compte: '613200' }] });
    expect(identifierCandidatsFraisVehicule([e], ['613200'])).toHaveLength(1);
  });
});
