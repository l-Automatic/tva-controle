import { describe, it, expect } from 'vitest';
import { MistralClient } from '../src/client.js';
import { jugerLibellesHotel } from '../src/jugementHotel.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

describe('jugerLibellesHotel', () => {
  it('retourne un tableau vide sans appel réseau si aucune écriture fournie', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    const resultat = await jugerLibellesHotel(client, []);
    expect(resultat).toEqual([]);
    expect(appele).toBe(false);
  });

  it('extrait un jugement positif reconnaissant une enseigne hôtelière', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [
            {
              ledgerEntryId: 42,
              estHotel: true,
              confiance: 'haute',
              justification: 'IBIS est une enseigne hôtelière reconnue',
            },
          ],
        })
      ),
    });

    const resultat = await jugerLibellesHotel(client, [{ ledgerEntryId: 42, libelle: 'IBIS PARIS 12/01' }]);
    expect(resultat).toEqual([
      { ledgerEntryId: 42, estHotel: true, confiance: 'haute', justification: 'IBIS est une enseigne hôtelière reconnue' },
    ]);
  });

  it('extrait un jugement négatif', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [{ ledgerEntryId: 1, estHotel: false, confiance: 'basse', justification: 'Aucun motif reconnu' }],
        })
      ),
    });
    const resultat = await jugerLibellesHotel(client, [{ ledgerEntryId: 1, libelle: 'PEAGE A6 15/01' }]);
    expect(resultat[0]?.estHotel).toBe(false);
  });

  it('ignore une entrée pour un id non demandé (le LLM en invente un)', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [
            { ledgerEntryId: 1, estHotel: true, confiance: 'haute', justification: 'x' },
            { ledgerEntryId: 999, estHotel: true, confiance: 'haute', justification: 'x' },
          ],
        })
      ),
    });
    const resultat = await jugerLibellesHotel(client, [{ ledgerEntryId: 1, libelle: 'IBIS' }]);
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.ledgerEntryId).toBe(1);
  });

  it('retourne un tableau vide plutôt qu’une erreur si la réponse est hors-format', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ inattendu: true })) });
    const resultat = await jugerLibellesHotel(client, [{ ledgerEntryId: 1, libelle: 'IBIS' }]);
    expect(resultat).toEqual([]);
  });

  it('ignore une entrée avec estHotel non booléen', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [{ ledgerEntryId: 1, estHotel: 'oui', confiance: 'haute', justification: 'x' }],
        })
      ),
    });
    const resultat = await jugerLibellesHotel(client, [{ ledgerEntryId: 1, libelle: 'IBIS' }]);
    expect(resultat).toEqual([]);
  });
});
