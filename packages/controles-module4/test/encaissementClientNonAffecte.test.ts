import { describe, it, expect } from 'vitest';
import type { LigneEcritureAvecLettrage, ContexteDossier } from '@tva-controle/core';
import { detecterEncaissementsClientAAffecter } from '../src/encaissementClientNonAffecte.js';

function ligne(overrides: Partial<LigneEcritureAvecLettrage> = {}): LigneEcritureAvecLettrage {
  return {
    id: 1,
    compte: '411ROUSSEAU',
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

function contexte(overrides: Partial<ContexteDossier> = {}): ContexteDossier {
  return { tauxHistorique: [], conventions: [], parcVehicules: [], ...overrides };
}

describe('detecterEncaissementsClientAAffecter', () => {
  it('applique le taux historique connu du compte client s’il est confirmé', () => {
    const l = ligne({ credit: 1200, compte: '411ROUSSEAU' });
    const ctx = contexte({ tauxHistorique: [{ compteOuTiers: '411ROUSSEAU', tauxHabituel: 10, nbOccurrences: 5 }] });

    const { regularisations, anomalies } = detecterEncaissementsClientAAffecter([l], ctx);

    expect(regularisations).toEqual([
      { ledgerEntryId: 100, compte: '411ROUSSEAU', montantTTC: 1200, taux: 10, source: 'taux_historique' },
    ]);
    expect(anomalies[0]).toMatchObject({
      type: 'encaissement_client_taux_applique',
      gravite: 'signale',
      details: { tauxApplique: 10, source: 'taux_historique' },
    });
  });

  it('applique 20% par défaut si aucun taux historique connu pour ce compte', () => {
    const l = ligne({ credit: 600, compte: '411INCONNU' });
    const ctx = contexte({ tauxHistorique: [] });

    const { regularisations } = detecterEncaissementsClientAAffecter([l], ctx);

    expect(regularisations).toEqual([
      { ledgerEntryId: 100, compte: '411INCONNU', montantTTC: 600, taux: 20, source: 'defaut_prudence_20' },
    ]);
  });

  it('ignore une ligne déjà lettrée — a une facture en face, rien à régulariser', () => {
    const l = ligne({ credit: 1200, lettrage: { estLettree: true, groupeIds: [1, 2] } });
    const ctx = contexte();

    const { regularisations, anomalies } = detecterEncaissementsClientAAffecter([l], ctx);
    expect(regularisations).toEqual([]);
    expect(anomalies).toEqual([]);
  });

  it('ignore une ligne débitrice — pas un encaissement', () => {
    const l = ligne({ debit: 500, credit: 0 });
    const { regularisations } = detecterEncaissementsClientAAffecter([l], contexte());
    expect(regularisations).toEqual([]);
  });

  it('traite plusieurs comptes clients indépendamment, avec leurs taux respectifs', () => {
    const lignes = [
      ligne({ ledgerEntryId: 1, compte: '411A', credit: 100 }),
      ligne({ ledgerEntryId: 2, compte: '411B', credit: 200 }),
    ];
    const ctx = contexte({ tauxHistorique: [{ compteOuTiers: '411A', tauxHabituel: 5.5, nbOccurrences: 4 }] });

    const { regularisations } = detecterEncaissementsClientAAffecter(lignes, ctx);

    expect(regularisations).toEqual([
      { ledgerEntryId: 1, compte: '411A', montantTTC: 100, taux: 5.5, source: 'taux_historique' },
      { ledgerEntryId: 2, compte: '411B', montantTTC: 200, taux: 20, source: 'defaut_prudence_20' },
    ]);
  });
});

describe('detecterEncaissementsClientAAffecter — regime TVA sur encaissement (09/08)', () => {
  it('regime "bien" : aucune regularisation ni anomalie, meme sur un encaissement non lettre', () => {
    const l = ligne({ credit: 1200, compte: '411ROUSSEAU' });
    const { regularisations, anomalies } = detecterEncaissementsClientAAffecter(
      [l],
      contexte(),
      'bien'
    );
    expect(regularisations).toEqual([]);
    expect(anomalies).toEqual([]);
  });

  it('regime "service" (defaut) : comportement inchange, applique le taux comme avant', () => {
    const l = ligne({ credit: 1200, compte: '411ROUSSEAU' });
    const { regularisations } = detecterEncaissementsClientAAffecter([l], contexte(), 'service');
    expect(regularisations).toHaveLength(1);
    expect(regularisations[0]?.taux).toBe(20);
  });

  it('sans regime precise, le defaut reste "service" (retro-compatible)', () => {
    const l = ligne({ credit: 1200, compte: '411ROUSSEAU' });
    const { regularisations } = detecterEncaissementsClientAAffecter([l], contexte());
    expect(regularisations).toHaveLength(1);
  });

  it('regime "mixte" : comportement prudent inchange (20% par defaut)', () => {
    const l = ligne({ credit: 1200, compte: '411ROUSSEAU' });
    const { regularisations } = detecterEncaissementsClientAAffecter([l], contexte(), 'mixte');
    expect(regularisations[0]?.taux).toBe(20);
  });
});
