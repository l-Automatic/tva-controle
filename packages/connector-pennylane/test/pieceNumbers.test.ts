import { describe, it, expect } from 'vitest';
import { PennylaneClient } from '../src/connectors/pennylane/client.js';
import { fetchPieceNumbers } from '../src/connectors/pennylane/pieceNumbers.js';

function fakeFetch(response: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(response), { status })) as unknown as typeof fetch;
}

describe('fetchPieceNumbers', () => {
  it('retourne une map vide sans appel réseau si aucun id fourni', async () => {
    let appele = false;
    const client = new PennylaneClient({
      token: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    const resultat = await fetchPieceNumbers(client, []);
    expect(resultat.size).toBe(0);
    expect(appele).toBe(false);
  });

  it('associe chaque id d’écriture à son piece_number', async () => {
    const client = new PennylaneClient({
      token: 'x',
      fetchImpl: fakeFetch({
        items: [
          { id: 1, piece_number: 'F-2025-06-042' },
          { id: 2, piece_number: 'F-2025-06-043' },
        ],
        has_more: false,
        next_cursor: null,
      }),
    });

    const resultat = await fetchPieceNumbers(client, [1, 2]);
    expect(resultat.get(1)).toBe('F-2025-06-042');
    expect(resultat.get(2)).toBe('F-2025-06-043');
  });

  it('mappe piece_number absent ou null vers null, pas undefined', async () => {
    const client = new PennylaneClient({
      token: 'x',
      fetchImpl: fakeFetch({ items: [{ id: 1 }], has_more: false, next_cursor: null }),
    });

    const resultat = await fetchPieceNumbers(client, [1]);
    expect(resultat.get(1)).toBeNull();
  });

  it('paginate via has_more/next_cursor', async () => {
    let appel = 0;
    const fetchImpl = (async () => {
      appel += 1;
      if (appel === 1) {
        return new Response(
          JSON.stringify({ items: [{ id: 1, piece_number: 'F-001' }], has_more: true, next_cursor: 'page2' }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ items: [{ id: 2, piece_number: 'F-002' }], has_more: false, next_cursor: null }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const resultat = await fetchPieceNumbers(client, [1, 2]);
    expect(resultat.get(1)).toBe('F-001');
    expect(resultat.get(2)).toBe('F-002');
    expect(appel).toBe(2);
  });
});
