import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PennylaneClient, PennylaneApiError } from '../src/connectors/pennylane/client.js';
import { fetchTrialBalance, filterComptesParPrefixe } from '../src/connectors/pennylane/trialBalance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'trial_balance_electricien.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

function fakeFetch(response: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(response), { status })) as unknown as typeof fetch;
}

describe('fetchTrialBalance — mapping vers le format pivot', () => {
  it('parse correctement les montants string en number, sur la fixture réelle du dossier sandbox', async () => {
    const client = new PennylaneClient({ token: 'fake-token', fetchImpl: fakeFetch(FIXTURE) });

    const balance = await fetchTrialBalance(client, {
      dossierId: 'dossier-test-electricien',
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
    });

    expect(balance.comptes).toHaveLength(7);

    const compte20 = balance.comptes.find((c) => c.numeroCompte === '445711');
    expect(compte20).toBeDefined();
    expect(compte20?.credit).toBe(13186.47);
    expect(compte20?.debit).toBe(49.08); // avoir client, confirmé métier
    expect(typeof compte20?.credit).toBe('number'); // pas la string brute de l'API

    const compteAutoliq = balance.comptes.find((c) => c.numeroCompte === '4454');
    expect(compteAutoliq?.credit).toBe(5268.43);

    const compteAutoliqDed = balance.comptes.find((c) => c.numeroCompte === '445664');
    expect(compteAutoliqDed?.debit).toBe(5268.43);
  });

  it('transmet correctement les paramètres de période et is_auxiliary à l’API', async () => {
    const fetchSpy = fakeFetch(FIXTURE);
    const client = new PennylaneClient({ token: 'fake-token', fetchImpl: fetchSpy });

    await fetchTrialBalance(client, {
      dossierId: 'd1',
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
      isAuxiliary: true,
    });

    const calledUrl = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toBeDefined();
    expect(calledUrl).toContain('period_start=2025-03-01');
    expect(calledUrl).toContain('period_end=2025-03-31');
    expect(calledUrl).toContain('use_2026_api_changes=true');
    expect(calledUrl).toContain('is_auxiliary=true');
    expect(calledUrl).toContain('limit=1000');
  });

  it('échoue explicitement sur un montant non numérique plutôt que de produire un NaN silencieux', async () => {
    const corrompu = {
      ...FIXTURE,
      items: [{ ...FIXTURE.items[0], debits: 'NOT_A_NUMBER' }],
    };
    const client = new PennylaneClient({ token: 'fake-token', fetchImpl: fakeFetch(corrompu) });

    await expect(
      fetchTrialBalance(client, { dossierId: 'd1', periodeDebut: '2025-03-01', periodeFin: '2025-03-31' })
    ).rejects.toThrow(/Montant Pennylane invalide/);
  });

  it('suit la pagination cursor jusqu’à has_more: false, dans l’ordre', async () => {
    const page1 = {
      items: [FIXTURE.items[0], FIXTURE.items[1]],
      has_more: true,
      next_cursor: 'cursor-page-2',
      total_pages: null,
      current_page: null,
      per_page: null,
      total_items: null,
    };
    const page2 = {
      items: FIXTURE.items.slice(2),
      has_more: false,
      next_cursor: null,
      total_pages: null,
      current_page: null,
      per_page: null,
      total_items: null,
    };

    let call = 0;
    const fetchSpy = vi.fn(async (url: string) => {
      call += 1;
      const body = call === 1 ? page1 : page2;
      // Vérifie que le cursor de la page précédente est bien transmis à l'appel suivant
      if (call === 2) {
        expect(url).toContain('cursor=cursor-page-2');
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'fake-token', fetchImpl: fetchSpy });
    const balance = await fetchTrialBalance(client, {
      dossierId: 'd1',
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(balance.comptes).toHaveLength(7);
    expect(balance.comptes.map((c) => c.numeroCompte)).toEqual([
      '4454', '44562', '44566', '445664', '445711', '445712', '445713',
    ]);
  });

  it('lève une PennylaneApiError explicite sur une réponse HTTP en échec (ex: token invalide)', async () => {
    const client = new PennylaneClient({
      token: 'fake-token',
      fetchImpl: fakeFetch({ error: 'unauthorized' }, 401),
    });

    await expect(
      fetchTrialBalance(client, { dossierId: 'd1', periodeDebut: '2025-03-01', periodeFin: '2025-03-31' })
    ).rejects.toBeInstanceOf(PennylaneApiError);
  });
});

describe('filterComptesParPrefixe', () => {
  it('isole les comptes TVA collectée (445710-445719) sans capter le 4454 ni le 44566', async () => {
    const client = new PennylaneClient({ token: 'fake-token', fetchImpl: fakeFetch(FIXTURE) });
    const balance = await fetchTrialBalance(client, {
      dossierId: 'd1',
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
    });

    const collectee = filterComptesParPrefixe(balance, ['44571']);
    expect(collectee.map((c) => c.numeroCompte)).toEqual(['445711', '445712', '445713']);
  });

  it('sépare correctement 4454 (due autoliquidée) de 445664 (déductible autoliquidée)', async () => {
    const client = new PennylaneClient({ token: 'fake-token', fetchImpl: fakeFetch(FIXTURE) });
    const balance = await fetchTrialBalance(client, {
      dossierId: 'd1',
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
    });

    const due = filterComptesParPrefixe(balance, ['4454']);
    // Piège : le préfixe "4454" matche aussi bien "4454" que "445664"? Non — "445664" ne commence pas par "4454".
    expect(due.map((c) => c.numeroCompte)).toEqual(['4454']);
  });
});
