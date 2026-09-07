import { describe, it, expect } from 'vitest';
import { PennylaneClient } from '../src/connectors/pennylane/client.js';
import { resolveJournalsByIds } from '../src/connectors/pennylane/resolveJournals.js';

function fakeFetch(response: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(response), { status })) as unknown as typeof fetch;
}

describe('resolveJournalsByIds', () => {
  it('retourne une map vide sans appel réseau si aucun id fourni', async () => {
    let appele = false;
    const client = new PennylaneClient({
      token: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    const resultat = await resolveJournalsByIds(client, []);
    expect(resultat.size).toBe(0);
    expect(appele).toBe(false);
  });

  it('bug réel corrigé (10/08, confirmé par une vraie erreur 400) : n’envoie JAMAIS de filtre "id" — /journals ne l’accepte pas', async () => {
    let urlAppelee = '';
    const client = new PennylaneClient({
      token: 'x',
      fetchImpl: (async (rawUrl: string) => {
        urlAppelee = rawUrl;
        return new Response(
          JSON.stringify({ items: [{ id: 1, code: 'VE', label: 'VE' }], has_more: false, next_cursor: null }),
          { status: 200 }
        );
      }) as unknown as typeof fetch,
    });

    await resolveJournalsByIds(client, [1]);
    expect(urlAppelee).not.toContain('filter');
    expect(urlAppelee).not.toContain('"field":"id"');
  });

  it('filtre côté client : ne retourne que les journaux dont l’id a été demandé, même si la réponse en contient d’autres', async () => {
    const client = new PennylaneClient({
      token: 'x',
      fetchImpl: fakeFetch({
        items: [
          { id: 1, code: 'VE', label: 'VE' },
          { id: 2, code: 'AC', label: 'AC' },
          { id: 3, code: 'BQ', label: 'BQ' },
        ],
        has_more: false,
        next_cursor: null,
      }),
    });

    const resultat = await resolveJournalsByIds(client, [1, 3]);
    expect(resultat.size).toBe(2);
    expect(resultat.get(1)).toEqual({ id: 1, code: 'VE', label: 'VE' });
    expect(resultat.get(3)).toEqual({ id: 3, code: 'BQ', label: 'BQ' });
    expect(resultat.has(2)).toBe(false);
  });

  it('suit la pagination jusqu’à épuisement', async () => {
    let appel = 0;
    const client = new PennylaneClient({
      token: 'x',
      fetchImpl: (async () => {
        appel += 1;
        if (appel === 1) {
          return new Response(
            JSON.stringify({ items: [{ id: 1, code: 'VE', label: 'VE' }], has_more: true, next_cursor: 'page2' }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({ items: [{ id: 2, code: 'AC', label: 'AC' }], has_more: false, next_cursor: null }),
          { status: 200 }
        );
      }) as unknown as typeof fetch,
    });

    const resultat = await resolveJournalsByIds(client, [1, 2]);
    expect(appel).toBe(2);
    expect(resultat.size).toBe(2);
  });
});
