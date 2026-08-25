import { describe, it, expect } from 'vitest';
import { chercherDansReferentiel } from '../src/referentielComptesCharge.js';

describe('chercherDansReferentiel', () => {
  it('reconnaît un compte "toujours bien" avec categorie: null', () => {
    expect(chercherDansReferentiel('601100')).toEqual({
      prefixe: '601',
      categorie: null,
      justification: 'Achats de matières premières et fournitures : toujours un bien.',
    });
  });

  it('reconnaît un compte "toujours service"', () => {
    const resultat = chercherDansReferentiel('6041');
    expect(resultat?.categorie).toBe('comptes_charge_service');
  });

  it('6063 et 6064 sont bien classés "bien", pas "équipement" (correction du 10/08)', () => {
    expect(chercherDansReferentiel('6063')?.categorie).toBeNull();
    expect(chercherDansReferentiel('6064')?.categorie).toBeNull();
  });

  it('606140 (carburant) n’est PAS dans le référentiel — reste géré par le LLM sur demande explicite de Rami', () => {
    expect(chercherDansReferentiel('606140')).toBeNull();
  });

  it('6234 (cadeaux) n’est PAS dans le référentiel — "normalement" seulement, reste géré par le LLM', () => {
    expect(chercherDansReferentiel('6234')).toBeNull();
  });

  it('retourne null pour un compte totalement inconnu du référentiel', () => {
    expect(chercherDansReferentiel('999999')).toBeNull();
  });

  it('6236 (imprimés) reste "bien" même s’il est un sous-compte de 623 (majoritairement service)', () => {
    expect(chercherDansReferentiel('6236')?.categorie).toBeNull();
  });
});
