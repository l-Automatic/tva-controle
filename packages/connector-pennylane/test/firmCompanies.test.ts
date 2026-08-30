import { describe, it, expect } from 'vitest';
import { fetchDossiersCabinet } from '../src/connectors/pennylane/firmCompanies.js';

function reponse(items: unknown[], page: number, totalPages: number) {
  return new Response(
    JSON.stringify({ items, total_pages: totalPages, current_page: page, total_items: items.length, per_page: 100 }),
    { status: 200 }
  );
}

describe('fetchDossiersCabinet', () => {
  it('mappe tous les champs confirmés par le schéma OpenAPI officiel', async () => {
    const fetchImpl = (async () =>
      reponse(
        [
          {
            id: 22938,
            name: 'Koss Inc.',
            billing_company_name: 'Koss',
            siren: '362521879',
            address: '35508 Mary Plain',
            city: 'Jefferson City',
            postal_code: '77379',
            activity_code: '1234A',
            external_id: 'G6YYYLPXIZ',
            client_code: 'DOSSIER_ABC',
          },
        ],
        1,
        1
      )) as unknown as typeof fetch;

    const resultat = await fetchDossiersCabinet('jeton', fetchImpl);
    expect(resultat).toEqual([
      {
        id: '22938',
        nom: 'Koss Inc.',
        nomCommercial: 'Koss',
        siren: '362521879',
        adresse: '35508 Mary Plain',
        ville: 'Jefferson City',
        codePostal: '77379',
        codeNaf: '1234A',
        externalId: 'G6YYYLPXIZ',
        codeClient: 'DOSSIER_ABC',
      },
    ]);
  });

  it('gère les champs optionnels absents sans planter', async () => {
    const fetchImpl = (async () => reponse([{ id: 1, name: 'Minimal' }], 1, 1)) as unknown as typeof fetch;
    const resultat = await fetchDossiersCabinet('jeton', fetchImpl);
    expect(resultat).toEqual([
      {
        id: '1',
        nom: 'Minimal',
        nomCommercial: null,
        siren: null,
        adresse: null,
        ville: null,
        codePostal: null,
        codeNaf: null,
        externalId: null,
        codeClient: null,
      },
    ]);
  });

  it('paginate par page (page/per_page/total_pages), pas par curseur', async () => {
    let appel = 0;
    const pagesAppelees: number[] = [];
    const fetchImpl = (async (url: string) => {
      appel += 1;
      const u = new URL(url);
      pagesAppelees.push(Number(u.searchParams.get('page')));
      if (appel === 1) return reponse([{ id: 1, name: 'Page1' }], 1, 2);
      return reponse([{ id: 2, name: 'Page2' }], 2, 2);
    }) as unknown as typeof fetch;

    const resultat = await fetchDossiersCabinet('jeton', fetchImpl);
    expect(resultat).toHaveLength(2);
    expect(pagesAppelees).toEqual([1, 2]);
  });

  it('lève une erreur claire sur une réponse non-ok', async () => {
    const fetchImpl = (async () => new Response('non autorisé', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchDossiersCabinet('mauvais-jeton', fetchImpl)).rejects.toThrow(/401/);
  });

  it('envoie bien le jeton en Bearer et per_page=100', async () => {
    let headerRecu: string | null = null;
    let perPageRecu: string | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      headerRecu = (init?.headers as Record<string, string>)['Authorization'] ?? null;
      perPageRecu = new URL(url).searchParams.get('per_page');
      return reponse([], 1, 1);
    }) as unknown as typeof fetch;

    await fetchDossiersCabinet('jeton-cabinet-123', fetchImpl);
    expect(headerRecu).toBe('Bearer jeton-cabinet-123');
    expect(perPageRecu).toBe('100');
  });
});
