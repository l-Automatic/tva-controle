import { describe, it, expect } from 'vitest';
import { MistralClient } from '../src/client.js';
import { suggererClassificationComptes } from '../src/classificationComptes.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

const categories = [
  { cle: 'comptes_vente_service', description: 'Ventes de prestations de service' },
  { cle: 'comptes_charge_autoliquidation', description: 'Achats de sous-traitance autoliquidée' },
];

describe('suggererClassificationComptes', () => {
  it('retourne un tableau vide sans appel réseau si aucun compte fourni', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    const resultat = await suggererClassificationComptes(client, [], categories);
    expect(resultat).toEqual([]);
    expect(appele).toBe(false);
  });

  it('extrait les suggestions valides de la réponse', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          suggestions: [
            {
              compte: '604AUTOLIQ',
              categorie: 'comptes_charge_autoliquidation',
              confiance: 'haute',
              justification: 'Le libellé mentionne explicitement "autoliquidation"',
            },
          ],
        })
      ),
    });

    const resultat = await suggererClassificationComptes(
      client,
      [{ compte: '604AUTOLIQ', nomCompte: 'Sous-traitance autoliquidée' }],
      categories
    );

    expect(resultat).toEqual([
      {
        compte: '604AUTOLIQ',
        categorieSuggeree: 'comptes_charge_autoliquidation',
        confiance: 'haute',
        justification: 'Le libellé mentionne explicitement "autoliquidation"',
        source: 'ia',
      },
    ]);
  });

  it('accepte categorie: null (le modèle n’est pas obligé de deviner)', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          suggestions: [{ compte: '607', categorie: null, confiance: 'basse', justification: 'Libellé ambigu' }],
        })
      ),
    });

    const resultat = await suggererClassificationComptes(
      client,
      [{ compte: '607', nomCompte: 'Achats de marchandises' }],
      categories
    );
    expect(resultat[0]?.categorieSuggeree).toBeNull();
  });

  it('ignore silencieusement une entrée pour un compte non demandé (le LLM en invente un)', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          suggestions: [
            { compte: '607', categorie: 'comptes_vente_service', confiance: 'haute', justification: 'x' },
            { compte: 'INVENTE_PAR_LE_LLM', categorie: 'comptes_vente_service', confiance: 'haute', justification: 'x' },
          ],
        })
      ),
    });

    const resultat = await suggererClassificationComptes(
      client,
      [{ compte: '607', nomCompte: 'Achats de marchandises' }],
      categories
    );
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.compte).toBe('607');
  });

  it('retourne un tableau vide (jamais une erreur) si la réponse est totalement hors-format', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ inattendu: true })) });
    const resultat = await suggererClassificationComptes(
      client,
      [{ compte: '607', nomCompte: 'Achats de marchandises' }],
      categories
    );
    expect(resultat).toEqual([]);
  });

  it('ignore une entrée avec un champ confiance invalide plutôt que de planter', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          suggestions: [
            { compte: '607', categorie: 'comptes_vente_service', confiance: 'tres-sur-de-moi', justification: 'x' },
          ],
        })
      ),
    });

    const resultat = await suggererClassificationComptes(
      client,
      [{ compte: '607', nomCompte: 'Achats de marchandises' }],
      categories
    );
    expect(resultat).toEqual([]);
  });
});
