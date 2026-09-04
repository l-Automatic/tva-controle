import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { identifierCandidatsJugementVehiculeTourisme } from '../src/candidatsVehiculeTourisme.js';

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
      compte: overrides.compte ?? '44562',
      compteId: 1,
      libelle: overrides.libelle ?? 'ACHAT VEHICULE',
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

describe('identifierCandidatsJugementVehiculeTourisme', () => {
  it('candidat : 44562 avec TVA déduite ET une ligne 2182', () => {
    const e = ecriture({ debit: 4000, autresLignes: [{ compte: '2182' }] });
    expect(identifierCandidatsJugementVehiculeTourisme([e])).toHaveLength(1);
  });

  it('exclut si aucune TVA déduite (rien à corriger même si tourisme)', () => {
    const e = ecriture({ debit: 0, autresLignes: [{ compte: '2182' }] });
    expect(identifierCandidatsJugementVehiculeTourisme([e])).toEqual([]);
  });

  it('exclut si le compte n’est pas 44562', () => {
    const e = ecriture({ compte: '44566', debit: 4000, autresLignes: [{ compte: '2182' }] });
    expect(identifierCandidatsJugementVehiculeTourisme([e])).toEqual([]);
  });

  it('exclut si aucune ligne ne touche 2182 (une autre immobilisation, sans rapport)', () => {
    const e = ecriture({ debit: 4000, autresLignes: [{ compte: '2183' }] }); // informatique
    expect(identifierCandidatsJugementVehiculeTourisme([e])).toEqual([]);
  });
});
