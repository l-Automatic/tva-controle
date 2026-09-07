import { describe, it, expect } from 'vitest';
import { MistralClient } from '../src/client.js';
import { jugerVehiculeIdentifieDansLibelle } from '../src/jugerVehiculeIdentifieDansLibelle.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

describe('jugerVehiculeIdentifieDansLibelle', () => {
  it('retourne un tableau vide sans appel réseau si aucune écriture fournie', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    const resultat = await jugerVehiculeIdentifieDansLibelle(client, []);
    expect(resultat).toEqual([]);
    expect(appele).toBe(false);
  });

  it('extrait un jugement positif sur un libellé mentionnant un véhicule précis', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [
            { ledgerEntryId: 42, vehiculeIdentifie: true, confiance: 'haute', justification: 'Mentionne Trafic' },
          ],
        })
      ),
    });
    const resultat = await jugerVehiculeIdentifieDansLibelle(client, [
      { ledgerEntryId: 42, libelle: 'ENTRETIEN TRAFIC' },
    ]);
    expect(resultat).toEqual([
      { ledgerEntryId: 42, vehiculeIdentifie: true, confiance: 'haute', justification: 'Mentionne Trafic' },
    ]);
  });

  it('extrait un jugement négatif sur un libellé sans indication exploitable', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          jugements: [{ ledgerEntryId: 7, vehiculeIdentifie: false, confiance: 'haute', justification: 'Rien de spécifique' }],
        })
      ),
    });
    const resultat = await jugerVehiculeIdentifieDansLibelle(client, [{ ledgerEntryId: 7, libelle: 'ENTRETIEN DIVERS' }]);
    expect(resultat[0]?.vehiculeIdentifie).toBe(false);
  });

  it('ignore un jugement dont le ledgerEntryId est inconnu', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({ jugements: [{ ledgerEntryId: 999, vehiculeIdentifie: true, confiance: 'haute', justification: 'x' }] })
      ),
    });
    const resultat = await jugerVehiculeIdentifieDansLibelle(client, [{ ledgerEntryId: 1, libelle: 'X' }]);
    expect(resultat).toEqual([]);
  });

  it('retourne un tableau vide si la réponse est malformée (jamais un faux positif silencieux)', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ autreChose: true })) });
    const resultat = await jugerVehiculeIdentifieDansLibelle(client, [{ ledgerEntryId: 1, libelle: 'X' }]);
    expect(resultat).toEqual([]);
  });
});
