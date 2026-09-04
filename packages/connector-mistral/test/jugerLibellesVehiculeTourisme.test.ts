import { describe, it, expect } from 'vitest';
import { MistralClient } from '../src/client.js';
import { jugerLibellesVehiculeTourisme } from '../src/jugerLibellesVehiculeTourisme.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

describe('jugerLibellesVehiculeTourisme', () => {
  it('retourne un tableau vide sans appel réseau si aucune écriture fournie', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    const resultat = await jugerLibellesVehiculeTourisme(client, []);
    expect(resultat).toEqual([]);
    expect(appele).toBe(false);
  });

  it('extrait un jugement positif sur un libellé de voiture de tourisme', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [
            { ledgerEntryId: 42, estTourisme: true, confiance: 'haute', justification: 'Peugeot 308, berline' },
          ],
        })
      ),
    });
    const resultat = await jugerLibellesVehiculeTourisme(client, [{ ledgerEntryId: 42, libelle: 'ACHAT PEUGEOT 308' }]);
    expect(resultat).toEqual([
      { ledgerEntryId: 42, estTourisme: true, confiance: 'haute', justification: 'Peugeot 308, berline' },
    ]);
  });

  it('extrait un jugement négatif sur un libellé d’utilitaire', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [{ ledgerEntryId: 7, estTourisme: false, confiance: 'haute', justification: 'Fourgon utilitaire' }],
        })
      ),
    });
    const resultat = await jugerLibellesVehiculeTourisme(client, [{ ledgerEntryId: 7, libelle: 'ACHAT FOURGON RENAULT MASTER' }]);
    expect(resultat[0]?.estTourisme).toBe(false);
  });

  it('ignore un jugement dont le ledgerEntryId est inconnu', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({ jugements: [{ ledgerEntryId: 999, estTourisme: true, confiance: 'haute', justification: 'x' }] })
      ),
    });
    const resultat = await jugerLibellesVehiculeTourisme(client, [{ ledgerEntryId: 1, libelle: 'X' }]);
    expect(resultat).toEqual([]);
  });

  it('retourne un tableau vide si la réponse est malformée (jamais un throw silencieux transformé en faux positif)', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ autreChose: true })) });
    const resultat = await jugerLibellesVehiculeTourisme(client, [{ ledgerEntryId: 1, libelle: 'X' }]);
    expect(resultat).toEqual([]);
  });
});
