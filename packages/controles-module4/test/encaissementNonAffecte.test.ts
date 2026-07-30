import { describe, it, expect } from 'vitest';
import type { LigneEcritureAvecLettrage } from '@tva-controle/core';
import { detecterEncaissementsNonAffectes } from '../src/encaissementNonAffecte.js';

function ligne(overrides: Partial<LigneEcritureAvecLettrage> = {}): LigneEcritureAvecLettrage {
  return {
    id: 1,
    compte: '471000',
    compteId: 1,
    libelle: 'Virement reçu',
    debit: 0,
    credit: 0,
    date: '2025-01-15',
    ledgerEntryId: 100,
    lettrage: { estLettree: false, groupeIds: [] },
    ...overrides,
  };
}

describe('detecterEncaissementsNonAffectes', () => {
  it('signale une ligne créditrice non lettrée sur le compte d’attente', () => {
    const lignes = [ligne({ credit: 1200, ledgerEntryId: 100, compte: '471000' })];

    const anomalies = detecterEncaissementsNonAffectes(lignes);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      type: 'encaissement_non_affecte',
      gravite: 'bloquant',
      ledgerEntryId: 100,
      compte: '471000',
      details: { montantTTC: 1200, libelle: 'Virement reçu', date: '2025-01-15' },
    });
  });

  it('ignore une ligne créditrice déjà lettrée — déjà identifiée côté Pennylane', () => {
    const lignes = [
      ligne({ credit: 1200, lettrage: { estLettree: true, groupeIds: [100, 101] } }),
    ];

    expect(detecterEncaissementsNonAffectes(lignes)).toHaveLength(0);
  });

  it('ignore les lignes débitrices — une régularisation qui solde le compte, pas un encaissement', () => {
    const lignes = [ligne({ debit: 1200, credit: 0 })];

    expect(detecterEncaissementsNonAffectes(lignes)).toHaveLength(0);
  });

  it('traite plusieurs lignes indépendamment', () => {
    const lignes = [
      ligne({ credit: 500, ledgerEntryId: 1 }),
      ligne({ credit: 0, debit: 500, ledgerEntryId: 2 }),
      ligne({ credit: 300, ledgerEntryId: 3, lettrage: { estLettree: true, groupeIds: [3, 4] } }),
      ligne({ credit: 700, ledgerEntryId: 4 }),
    ];

    const anomalies = detecterEncaissementsNonAffectes(lignes);

    expect(anomalies.map((a) => a.ledgerEntryId).sort()).toEqual([1, 4]);
  });
});
