import { describe, it, expect } from 'vitest';
import { MistralClient } from '../src/client.js';
import { suggererCategorisationComptes } from '../src/suggererCategorisationComptes.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

describe('suggererCategorisationComptes', () => {
  it('retourne un tableau vide sans appel réseau si aucun compte fourni', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    const resultat = await suggererCategorisationComptes(client, []);
    expect(resultat).toEqual([]);
    expect(appele).toBe(false);
  });

  it('extrait une suggestion avec confiance haute', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          suggestions: [
            {
              compte: '606100',
              categorieSuggeree: 'comptes_carburant',
              confiance: 'haute',
              justification: 'Libellés mentionnant "essence"',
            },
          ],
        })
      ),
    });
    const resultat = await suggererCategorisationComptes(client, [{ compte: '606100', exemplesLibelle: ['Essence station'] }]);
    expect(resultat).toEqual([
      {
        compte: '606100',
        categorieSuggeree: 'comptes_carburant',
        confiance: 'haute',
        justification: 'Libellés mentionnant "essence"',
      },
    ]);
  });

  it('accepte categorieSuggeree: null quand l’IA ne se prononce pas', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({ suggestions: [{ compte: '628000', categorieSuggeree: null, confiance: 'basse', justification: 'Aucun indice clair' }] })
      ),
    });
    const resultat = await suggererCategorisationComptes(client, [{ compte: '628000', exemplesLibelle: [] }]);
    expect(resultat[0]?.categorieSuggeree).toBeNull();
  });

  it('ignore une suggestion avec une catégorie invalide, jamais une catégorie inventée', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({ suggestions: [{ compte: '606100', categorieSuggeree: 'categorie_qui_n_existe_pas', confiance: 'haute', justification: 'x' }] })
      ),
    });
    const resultat = await suggererCategorisationComptes(client, [{ compte: '606100', exemplesLibelle: [] }]);
    expect(resultat).toEqual([]);
  });

  it('ignore une suggestion dont le compte est inconnu', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(JSON.stringify({ suggestions: [{ compte: '999999', categorieSuggeree: 'comptes_carburant', confiance: 'haute', justification: 'x' }] })),
    });
    const resultat = await suggererCategorisationComptes(client, [{ compte: '606100', exemplesLibelle: [] }]);
    expect(resultat).toEqual([]);
  });

  it('retourne un tableau vide si la réponse est malformée', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ autreChose: true })) });
    const resultat = await suggererCategorisationComptes(client, [{ compte: '606100', exemplesLibelle: [] }]);
    expect(resultat).toEqual([]);
  });
});
