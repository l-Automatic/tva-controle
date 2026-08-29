import { describe, it, expect } from 'vitest';
import { fetchDossiersCabinet } from '../src/connectors/pennylane/firmCompanies.js';

describe('fetchDossiersCabinet', () => {
  it('mappe les dossiers renvoyés (forme items)', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          items: [
            { id: 111, name: 'Electricien Sandbox', siren: '123456789' },
            { id: 222, name: 'Plombier Test', siren: null },
          ],
          has_more: false,
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const resultat = await fetchDossiersCabinet('mon-jeton', fetchImpl);
    expect(resultat).toEqual([
      { id: '111', nom: 'Electricien Sandbox', siren: '123456789' },
      { id: '222', nom: 'Plombier Test', siren: null },
    ]);
  });

  it('gère aussi une forme de réponse "data" au lieu de "items"', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: 1, name: 'X' }], has_more: false }), {
        status: 200,
      })) as unknown as typeof fetch;

    const resultat = await fetchDossiersCabinet('x', fetchImpl);
    expect(resultat).toEqual([{ id: '1', nom: 'X', siren: null }]);
  });

  it('paginate via has_more/next_cursor', async () => {
    let appel = 0;
    const fetchImpl = (async () => {
      appel += 1;
      if (appel === 1) {
        return new Response(
          JSON.stringify({ items: [{ id: 1, name: 'Page1' }], has_more: true, next_cursor: 'page2' }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ items: [{ id: 2, name: 'Page2' }], has_more: false }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const resultat = await fetchDossiersCabinet('x', fetchImpl);
    expect(resultat).toHaveLength(2);
    expect(appel).toBe(2);
  });

  it('lève une erreur claire sur une réponse non-ok', async () => {
    const fetchImpl = (async () => new Response('non autorisé', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchDossiersCabinet('mauvais-jeton', fetchImpl)).rejects.toThrow(/401/);
  });

  it('envoie bien le jeton en Bearer', async () => {
    let headerRecu: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      headerRecu = (init?.headers as Record<string, string>)['Authorization'] ?? null;
      return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchDossiersCabinet('jeton-cabinet-123', fetchImpl);
    expect(headerRecu).toBe('Bearer jeton-cabinet-123');
  });
});
