import { describe, it, expect } from 'vitest';
import { FirmApiClient, FirmApiError } from '../src/connectors/pennylane/firmClient.js';

function fakeFetch(reponses: { url: string; body: unknown; status?: number }[]): {
  fetchImpl: typeof fetch;
  urlsAppelees: string[];
} {
  const urlsAppelees: string[] = [];
  const fetchImpl = (async (url: string) => {
    urlsAppelees.push(url);
    const r = reponses.find((x) => url.startsWith(x.url)) ?? reponses[0]!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urlsAppelees };
}

describe('FirmApiClient — réécriture de chemin (transparence pour les fonctions existantes)', () => {
  it('réécrit un chemin Company API vers son équivalent Firm API scopé au dossier', async () => {
    const { fetchImpl, urlsAppelees } = fakeFetch([{ url: 'https://app.pennylane.com', body: { items: [] } }]);
    const client = new FirmApiClient({ token: 'firm-token', companyId: '999', fetchImpl });

    await client.get('/api/external/v2/ledger_entry_lines');

    expect(urlsAppelees[0]).toBe(
      'https://app.pennylane.com/api/external/firm/v1/companies/999/ledger_entry_lines'
    );
  });

  it('conserve les paramètres de requête lors de la réécriture', async () => {
    const { fetchImpl, urlsAppelees } = fakeFetch([{ url: 'https://app.pennylane.com', body: {} }]);
    const client = new FirmApiClient({ token: 'x', companyId: '42', fetchImpl });

    await client.get('/api/external/v2/ledger_accounts', { limit: 100, cursor: 'abc' });

    const url = new URL(urlsAppelees[0]!);
    expect(url.pathname).toBe('/api/external/firm/v1/companies/42/ledger_accounts');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('cursor')).toBe('abc');
  });

  it('envoie le jeton cabinet en Bearer, comme le client Company API', async () => {
    let headerRecu: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      headerRecu = (init?.headers as Record<string, string>)['Authorization'] ?? null;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = new FirmApiClient({ token: 'mon-jeton-cabinet', companyId: '1', fetchImpl });

    await client.get('/api/external/v2/ledger_entries');
    expect(headerRecu).toBe('Bearer mon-jeton-cabinet');
  });

  it('laisse un chemin déjà explicite Firm API inchangé (pas de double réécriture)', async () => {
    const { fetchImpl, urlsAppelees } = fakeFetch([{ url: 'https://app.pennylane.com', body: {} }]);
    const client = new FirmApiClient({ token: 'x', companyId: '1', fetchImpl });

    await client.get('/api/external/firm/v1/companies');

    expect(urlsAppelees[0]).toBe('https://app.pennylane.com/api/external/firm/v1/companies');
  });

  it('retente sur un 429 avant d’échouer, comme le client Company API', async () => {
    let appel = 0;
    const fetchImpl = (async () => {
      appel += 1;
      if (appel === 1) {
        return new Response('', { status: 429, headers: { 'retry-after': '0.01' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new FirmApiClient({ token: 'x', companyId: '1', fetchImpl, maxRetries429: 3 });

    const resultat = await client.get<{ ok: boolean }>('/api/external/v2/ledger_entries');
    expect(resultat.ok).toBe(true);
    expect(appel).toBe(2);
  });

  it('lève FirmApiError sur une réponse non-ok', async () => {
    const fetchImpl = (async () => new Response('erreur serveur', { status: 500 })) as unknown as typeof fetch;
    const client = new FirmApiClient({ token: 'x', companyId: '1', fetchImpl });

    await expect(client.get('/api/external/v2/ledger_entries')).rejects.toThrow(FirmApiError);
  });
});
