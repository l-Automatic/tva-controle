import { describe, it, expect } from 'vitest';
import { MistralClient } from '../src/client.js';
import { jugerPaiementPartielAchat } from '../src/jugerPaiementPartielAchat.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

describe('jugerPaiementPartielAchat', () => {
  it('retourne lienEtabli: false sans appel réseau si aucune ligne fournie', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    const resultat = await jugerPaiementPartielAchat(client, []);
    expect(resultat.lienEtabli).toBe(false);
    expect(appele).toBe(false);
  });

  it('extrait un lien établi avec les deux montants, sans calculer de prorata', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          lienEtabli: true,
          montantFacture: 1000,
          montantPayeRattache: 400,
          confiance: 'haute',
          justification: 'Le libellé mentionne "acompte 40%" sur la facture identifiée',
        })
      ),
    });

    const resultat = await jugerPaiementPartielAchat(client, [
      { libelle: 'FACTURE 042', debit: 0, credit: 1000, date: '2025-01-01' },
      { libelle: 'ACOMPTE 40% FACT 042', debit: 400, credit: 0, date: '2025-01-15' },
    ]);

    expect(resultat).toEqual({
      lienEtabli: true,
      montantFacture: 1000,
      montantPayeRattache: 400,
      confiance: 'haute',
      justification: 'Le libellé mentionne "acompte 40%" sur la facture identifiée',
    });
  });

  it('accepte lienEtabli: false quand le groupe est trop ambigu', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          lienEtabli: false,
          montantFacture: null,
          montantPayeRattache: null,
          confiance: 'basse',
          justification: 'Plusieurs factures mélangées, attribution impossible',
        })
      ),
    });

    const resultat = await jugerPaiementPartielAchat(client, [
      { libelle: 'DIVERS', debit: 0, credit: 500, date: '2025-01-01' },
      { libelle: 'DIVERS', debit: 0, credit: 300, date: '2025-01-05' },
      { libelle: 'REGLEMENT', debit: 400, credit: 0, date: '2025-01-15' },
    ]);

    expect(resultat.lienEtabli).toBe(false);
    expect(resultat.montantFacture).toBeNull();
  });

  it('rejette un montantFacture à 0 ou négatif (division par zéro évitée)', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          lienEtabli: true,
          montantFacture: 0,
          montantPayeRattache: 100,
          confiance: 'haute',
          justification: 'x',
        })
      ),
    });
    const resultat = await jugerPaiementPartielAchat(client, [
      { libelle: 'x', debit: 0, credit: 0, date: '2025-01-01' },
    ]);
    expect(resultat.lienEtabli).toBe(false);
  });

  it('retourne lienEtabli: false (jamais une erreur) si la réponse est hors-format', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ inattendu: true })) });
    const resultat = await jugerPaiementPartielAchat(client, [
      { libelle: 'x', debit: 0, credit: 100, date: '2025-01-01' },
    ]);
    expect(resultat.lienEtabli).toBe(false);
  });
});
