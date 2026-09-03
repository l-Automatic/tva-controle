import { describe, it, expect } from 'vitest';
import { MistralClient, MistralReponseInvalideError } from '../src/client.js';
import { jugerCandidatsPaiementAchat } from '../src/jugerCandidatsPaiementAchat.js';

function fakeFetch(contenu: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: contenu } }] }), { status: 200 })) as unknown as typeof fetch;
}

const facture = { libelle: 'FACTURE ACCORD HOTEL', montant: 1000, date: '2025-01-01' };

describe('jugerCandidatsPaiementAchat', () => {
  it('retourne candidats: null sans appel réseau si aucun candidat fourni', async () => {
    let appele = false;
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: (async () => {
        appele = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    const resultat = await jugerCandidatsPaiementAchat(client, facture, []);
    expect(resultat.candidats).toBeNull();
    expect(appele).toBe(false);
  });

  it('précoche chaque candidat individuellement, avec sa propre confiance', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({
          candidats: [
            { ledgerEntryId: 1, precoche: true, confiance: 'haute', justification: 'Libellé "CB ACCORD HOTEL" correspond' },
            { ledgerEntryId: 2, precoche: false, confiance: 'basse', justification: 'Aucun lien apparent' },
          ],
        })
      ),
    });

    const resultat = await jugerCandidatsPaiementAchat(client, facture, [
      { ledgerEntryId: 1, libelle: 'CB ACCORD HOTEL', montant: 400, date: '2025-01-15' },
      { ledgerEntryId: 2, libelle: 'VIR SEPA DIVERS', montant: 200, date: '2025-01-20' },
    ]);

    expect(resultat.candidats).toHaveLength(2);
    expect(resultat.candidats?.[0]).toMatchObject({ ledgerEntryId: 1, precoche: true, confiance: 'haute' });
    expect(resultat.candidats?.[1]).toMatchObject({ ledgerEntryId: 2, precoche: false, confiance: 'basse' });
  });

  it('lève MistralReponseInvalideError si la réponse n’est pas du JSON (même convention que jugementHotel.ts — à l’appelant de l’attraper)', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch('ceci nest pas du json') });
    await expect(
      jugerCandidatsPaiementAchat(client, facture, [{ ledgerEntryId: 1, libelle: 'X', montant: 100, date: '2025-01-01' }])
    ).rejects.toThrow(MistralReponseInvalideError);
  });

  it('retourne candidats: null si un ledgerEntryId inconnu apparaît dans la réponse', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({ candidats: [{ ledgerEntryId: 999, precoche: true, confiance: 'haute', justification: 'x' }] })
      ),
    });
    const resultat = await jugerCandidatsPaiementAchat(client, facture, [
      { ledgerEntryId: 1, libelle: 'X', montant: 100, date: '2025-01-01' },
    ]);
    expect(resultat.candidats).toBeNull();
  });

  it('retourne candidats: null si la réponse ne couvre pas tous les candidats attendus', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch(
        JSON.stringify({ candidats: [{ ledgerEntryId: 1, precoche: true, confiance: 'haute', justification: 'x' }] })
      ),
    });
    const resultat = await jugerCandidatsPaiementAchat(client, facture, [
      { ledgerEntryId: 1, libelle: 'X', montant: 100, date: '2025-01-01' },
      { ledgerEntryId: 2, libelle: 'Y', montant: 200, date: '2025-01-02' },
    ]);
    expect(resultat.candidats).toBeNull();
  });

  it('un tableau vide de candidats dans la réponse (ambiguïté totale) est traité comme une réponse incomplète, jamais un faux true', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch(JSON.stringify({ candidats: [] })) });
    const resultat = await jugerCandidatsPaiementAchat(client, facture, [
      { ledgerEntryId: 1, libelle: 'X', montant: 100, date: '2025-01-01' },
    ]);
    // 0 réponse pour 1 candidat attendu -> incomplet -> null, jamais un
    // tableau vide traité comme "tout est faux" par défaut.
    expect(resultat.candidats).toBeNull();
  });
});
