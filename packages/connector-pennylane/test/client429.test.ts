import { describe, it, expect } from 'vitest';
import { PennylaneClient, PennylaneApiError } from '../src/connectors/pennylane/client.js';

describe('PennylaneClient — gestion du rate limiting (429)', () => {
  it('retente automatiquement après un 429, en respectant retry-after', async () => {
    let appels = 0;
    const debut = Date.now();

    const fetchImpl = (async () => {
      appels += 1;
      if (appels === 1) {
        return new Response('Rate limit exceeded', {
          status: 429,
          headers: { 'retry-after': '0.05' }, // 50ms pour garder le test rapide
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });
    const resultat = await client.get<{ ok: boolean }>('/test');

    expect(resultat.ok).toBe(true);
    expect(appels).toBe(2);
    expect(Date.now() - debut).toBeGreaterThanOrEqual(40);
  });

  it('abandonne après maxRetries429 tentatives et lève une PennylaneApiError', async () => {
    let appels = 0;
    const fetchImpl = (async () => {
      appels += 1;
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: { 'retry-after': '0.01' },
      });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl, maxRetries429: 2 });

    await expect(client.get('/test')).rejects.toBeInstanceOf(PennylaneApiError);
    expect(appels).toBe(3); // tentative initiale + 2 retries
  });

  it('ne retente pas sur une autre erreur HTTP (ex: 401)', async () => {
    let appels = 0;
    const fetchImpl = (async () => {
      appels += 1;
      return new Response('Unauthorized', { status: 401 });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });
    await expect(client.get('/test')).rejects.toBeInstanceOf(PennylaneApiError);
    expect(appels).toBe(1);
  });
});
