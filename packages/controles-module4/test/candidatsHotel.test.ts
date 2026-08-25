import { describe, it, expect } from 'vitest';
import type { EcritureTvaComplete } from '@tva-controle/core';
import { identifierCandidatsJugementHotel } from '../src/candidatsHotel.js';

function ecriture(montantTva: number, compteFournisseur: string, libelle: string | null, ledgerEntryId = 1): EcritureTvaComplete {
  return {
    ledgerEntryId,
    ligneTva: {
      id: ledgerEntryId,
      compte: '44566',
      compteId: 1,
      libelle,
      debit: montantTva,
      credit: 0,
      date: '2025-01-01',
      ledgerEntryId,
      lettrage: { estLettree: false, groupeIds: [] },
    },
    autresLignes: [{ id: 1, compte: '6251', compteId: 1, libelle: null, debit: 500, credit: 0 }],
    lignesTiers: [
      {
        compte: compteFournisseur,
        compteId: 1,
        libelleCompte: null,
        debit: 0,
        credit: 600,
        lettrage: { estLettree: false, groupeIds: [] },
      },
    ],
  };
}

describe('identifierCandidatsJugementHotel', () => {
  it('propose un candidat sur un fournisseur générique avec TVA', () => {
    const noms = new Map([['401DIVERS', 'FOURNISSEURS DIVERS']]);
    const resultat = identifierCandidatsJugementHotel(
      [ecriture(20, '401DIVERS', 'IBIS PARIS 12/01')],
      noms
    );
    expect(resultat).toEqual([{ ledgerEntryId: 1, libelle: 'IBIS PARIS 12/01' }]);
  });

  it('exclut un fournisseur déjà identifié comme hôtel par le nom du compte (déjà couvert par le contrôle déterministe)', () => {
    const noms = new Map([['401HOTEL', 'HOTELS']]);
    expect(identifierCandidatsJugementHotel([ecriture(20, '401HOTEL', 'x')], noms)).toEqual([]);
  });

  it('exclut une écriture sans TVA', () => {
    const noms = new Map([['401DIVERS', 'FOURNISSEURS DIVERS']]);
    expect(identifierCandidatsJugementHotel([ecriture(0, '401DIVERS', 'x')], noms)).toEqual([]);
  });

  it('inclut un fournisseur au nom non résolu (ne peut pas être exclu comme hôtel connu)', () => {
    const resultat = identifierCandidatsJugementHotel([ecriture(20, '401INCONNU', 'x')], new Map());
    expect(resultat).toHaveLength(1);
  });
});
