import { describe, it, expect } from 'vitest';
import type { ContexteDossier } from '@tva-controle/core';
import { conventionValeur, conventionObjet } from '../src/db/dossierRepository.js';

function contexte(conventions: ContexteDossier['conventions']): ContexteDossier {
  return { tauxHistorique: [], conventions, parcVehicules: [], tiersConnus: [] };
}

describe('conventionValeur', () => {
  it('retourne la valeur si elle est une chaîne', () => {
    const c = contexte([{ cle: 'compte_tva_due_autoliquidee', valeur: '4454', statut: 'confirmed' }]);
    expect(conventionValeur(c, 'compte_tva_due_autoliquidee')).toBe('4454');
  });

  it('retourne undefined si la valeur est un objet (bug réel du 10/08 : motif de numérotation)', () => {
    const c = contexte([
      { cle: 'motif_numerotation_facture', valeur: { prefixe: 'FA-', suffixe: '', nombreChiffres: 3 }, statut: 'confirmed' },
    ]);
    expect(conventionValeur(c, 'motif_numerotation_facture')).toBeUndefined();
  });
});

describe('conventionObjet', () => {
  it('retourne l’objet quand la valeur en est un', () => {
    const motif = { prefixe: 'FA-2025-', suffixe: '', nombreChiffres: 3 };
    const c = contexte([{ cle: 'motif_numerotation_facture', valeur: motif, statut: 'confirmed' }]);
    expect(conventionObjet(c, 'motif_numerotation_facture')).toEqual(motif);
  });

  it('retourne undefined si la valeur est une chaîne, pas un objet', () => {
    const c = contexte([{ cle: 'x', valeur: '4454', statut: 'confirmed' }]);
    expect(conventionObjet(c, 'x')).toBeUndefined();
  });

  it('retourne undefined si la valeur est une liste (Array.isArray exclu explicitement)', () => {
    const c = contexte([{ cle: 'x', valeur: ['706', '704'], statut: 'confirmed' }]);
    expect(conventionObjet(c, 'x')).toBeUndefined();
  });

  it('retourne undefined si la clé n’existe pas', () => {
    expect(conventionObjet(contexte([]), 'inconnue')).toBeUndefined();
  });

  it('retourne undefined si la valeur est null', () => {
    const c = contexte([{ cle: 'x', valeur: null, statut: 'confirmed' }]);
    expect(conventionObjet(c, 'x')).toBeUndefined();
  });
});
