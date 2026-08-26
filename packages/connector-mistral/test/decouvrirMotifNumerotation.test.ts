import { describe, it, expect } from 'vitest';
import { MistralClient } from '../src/client.js';
import { decouvrirMotifNumerotation } from '../src/decouvrirMotifNumerotation.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

describe('decouvrirMotifNumerotation', () => {
  it('retourne null sans appel réseau si aucun exemple fourni', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await decouvrirMotifNumerotation(client, [])).toBeNull();
    expect(appele).toBe(false);
  });

  it('extrait un motif structuré valide', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          motif: {
            prefixe: 'FA-2025-',
            suffixe: '',
            nombreChiffres: 3,
            description: 'Compteur séquentiel à 3 chiffres, préfixé par FA- et l\'année',
          },
        })
      ),
    });

    const resultat = await decouvrirMotifNumerotation(client, ['FA-2025-001', 'FA-2025-002', 'FA-2025-003']);
    expect(resultat).toEqual({
      prefixe: 'FA-2025-',
      suffixe: '',
      nombreChiffres: 3,
      description: 'Compteur séquentiel à 3 chiffres, préfixé par FA- et l\'année',
    });
  });

  it('accepte motif: null quand le modèle ne trouve aucun motif cohérent', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ motif: null })) });
    const resultat = await decouvrirMotifNumerotation(client, ['DIVERS 1', 'CHOSE X', 'ABC123']);
    expect(resultat).toBeNull();
  });

  it('retourne null (jamais une erreur) si la réponse est hors-format', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ inattendu: true })) });
    expect(await decouvrirMotifNumerotation(client, ['FA-001'])).toBeNull();
  });

  it('accepte nombreChiffres: null (pas de zéros de tête fixes)', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          motif: { prefixe: 'FACT', suffixe: '', nombreChiffres: null, description: 'x' },
        })
      ),
    });
    const resultat = await decouvrirMotifNumerotation(client, ['FACT1', 'FACT12', 'FACT123']);
    expect(resultat?.nombreChiffres).toBeNull();
  });

  it('rejette un motif malformé (prefixe manquant) plutôt que de planter', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(JSON.stringify({ motif: { suffixe: '', nombreChiffres: 3, description: 'x' } })),
    });
    expect(await decouvrirMotifNumerotation(client, ['x'])).toBeNull();
  });
});
