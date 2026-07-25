import { describe, it, expect } from 'vitest';
import { mapAvecConcurrenceLimitee } from '../src/connectors/pennylane/concurrency.js';

describe('mapAvecConcurrenceLimitee', () => {
  it('ne dépasse jamais la concurrence demandée', async () => {
    let enCours = 0;
    let maxObserve = 0;

    const items = Array.from({ length: 20 }, (_, i) => i);
    const resultats = await mapAvecConcurrenceLimitee(items, 3, async (i) => {
      enCours += 1;
      maxObserve = Math.max(maxObserve, enCours);
      await new Promise((r) => setTimeout(r, 5));
      enCours -= 1;
      return i * 2;
    });

    expect(maxObserve).toBeLessThanOrEqual(3);
    expect(resultats).toEqual(items.map((i) => i * 2));
  });

  it('conserve l’ordre des résultats malgré des durées différentes', async () => {
    const items = [50, 10, 30];
    const resultats = await mapAvecConcurrenceLimitee(items, 3, async (delai) => {
      await new Promise((r) => setTimeout(r, delai));
      return delai;
    });
    expect(resultats).toEqual([50, 10, 30]);
  });

  it('gère une liste vide sans erreur', async () => {
    const resultats = await mapAvecConcurrenceLimitee([], 5, async (i) => i);
    expect(resultats).toEqual([]);
  });
});
