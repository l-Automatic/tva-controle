import { describe, it, expect } from 'vitest';
import { extraireNumeroSequence, detecterTrousNumerotation } from '../src/detecterTrousNumerotation.js';

const motif = { prefixe: 'FA-2025-', suffixe: '', nombreChiffres: 3 };

describe('extraireNumeroSequence', () => {
  it('extrait le compteur pour un libellé conforme au motif', () => {
    expect(extraireNumeroSequence('FA-2025-042', motif)).toBe(42);
  });

  it('retourne null si le préfixe ne correspond pas', () => {
    expect(extraireNumeroSequence('AUTRE-042', motif)).toBeNull();
  });

  it('retourne null si la partie numérique n’a pas le bon nombre de chiffres', () => {
    expect(extraireNumeroSequence('FA-2025-42', motif)).toBeNull();
  });

  it('retourne null si la partie extraite n’est pas numérique', () => {
    expect(extraireNumeroSequence('FA-2025-ABC', motif)).toBeNull();
  });

  it('gère un suffixe non vide', () => {
    expect(extraireNumeroSequence('FA-2025-042-FR', { prefixe: 'FA-2025-', suffixe: '-FR', nombreChiffres: 3 })).toBe(
      42
    );
  });

  it('sans nombreChiffres imposé (null), accepte n’importe quelle longueur', () => {
    expect(extraireNumeroSequence('FA-2025-4', { prefixe: 'FA-2025-', suffixe: '', nombreChiffres: null })).toBe(4);
  });
});

describe('detecterTrousNumerotation', () => {
  it('ne signale rien pour une séquence continue', () => {
    const factures = [
      { ledgerEntryId: 1, libelle: 'FA-2025-001' },
      { ledgerEntryId: 2, libelle: 'FA-2025-002' },
      { ledgerEntryId: 3, libelle: 'FA-2025-003' },
    ];
    expect(detecterTrousNumerotation(factures, motif)).toEqual([]);
  });

  it('signale un trou d’un seul numéro manquant', () => {
    const factures = [
      { ledgerEntryId: 1, libelle: 'FA-2025-001' },
      { ledgerEntryId: 3, libelle: 'FA-2025-003' },
    ];
    const anomalies = detecterTrousNumerotation(factures, motif);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe('trou_numerotation_facture');
    expect(anomalies[0]?.gravite).toBe('signale'); // jamais bloquant
    expect(anomalies[0]?.details).toMatchObject({ manquants: 1 });
  });

  it('signale un trou de plusieurs numéros manquants d’un coup', () => {
    const factures = [
      { ledgerEntryId: 1, libelle: 'FA-2025-001' },
      { ledgerEntryId: 5, libelle: 'FA-2025-005' },
    ];
    const anomalies = detecterTrousNumerotation(factures, motif);
    expect(anomalies[0]?.details).toMatchObject({ manquants: 3 });
  });

  it('ignore les libellés qui ne correspondent pas au motif, sans planter', () => {
    const factures = [
      { ledgerEntryId: 1, libelle: 'FA-2025-001' },
      { ledgerEntryId: 2, libelle: 'AUTRE SERIE X' },
      { ledgerEntryId: 3, libelle: 'FA-2025-002' },
    ];
    expect(detecterTrousNumerotation(factures, motif)).toEqual([]);
  });

  it('fonctionne peu importe l’ordre d’arrivée des factures (trie avant de comparer)', () => {
    const factures = [
      { ledgerEntryId: 2, libelle: 'FA-2025-002' },
      { ledgerEntryId: 1, libelle: 'FA-2025-001' },
    ];
    // 001 et 002 sont consécutifs (aucun trou réel) — vérifie que l'ordre
    // d'arrivée en entrée (ici inversé) n'introduit pas un faux trou.
    expect(detecterTrousNumerotation(factures, motif)).toEqual([]);
  });

  it('moins de 2 factures reconnues : rien à comparer, aucune anomalie', () => {
    expect(detecterTrousNumerotation([{ ledgerEntryId: 1, libelle: 'FA-2025-001' }], motif)).toEqual([]);
  });
});
