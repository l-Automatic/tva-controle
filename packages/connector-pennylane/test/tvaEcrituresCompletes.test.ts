import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PennylaneClient } from '../src/connectors/pennylane/client.js';
import { fetchEcrituresTvaCompletes } from '../src/connectors/pennylane/tvaEcrituresCompletes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

// Routeur de fausses réponses par URL — simule l'API réelle en dispatchant
// chaque appel de l'orchestrateur vers la fixture réelle correspondante.
function fakeFetchRouteur(): typeof fetch {
  const comptesTva = loadFixture('ledger_accounts_tva.json');
  const lignesTva = loadFixture('ledger_entry_lines_tva_rousseau_only.json');
  const pieceRousseau = loadFixture('piece_rousseau_lines.json');
  const comptesCandidats = loadFixture('ledger_accounts_candidats_rousseau.json');
  const lettrageRousseau = loadFixture('lettering_rousseau_lettree.json');

  return (async (rawUrl: string) => {
    const url = new URL(rawUrl);
    const filtre = url.searchParams.get('filter') ?? '';

    if (url.pathname === '/api/external/v2/ledger_accounts') {
      if (filtre.includes('"field":"number"')) {
        return new Response(JSON.stringify(comptesTva), { status: 200 });
      }
      if (filtre.includes('"field":"id"')) {
        return new Response(JSON.stringify(comptesCandidats), { status: 200 });
      }
    }

    if (url.pathname === '/api/external/v2/ledger_entry_lines') {
      if (filtre.includes('"field":"ledger_account_id"')) {
        return new Response(JSON.stringify(lignesTva), { status: 200 });
      }
      if (filtre.includes('"field":"id"')) {
        return new Response(JSON.stringify(lettrageRousseau), { status: 200 });
      }
    }

    if (/\/ledger_entries\/\d+\/ledger_entry_lines/.test(url.pathname)) {
      return new Response(JSON.stringify(pieceRousseau), { status: 200 });
    }

    throw new Error(`URL non routée dans le test : ${rawUrl}`);
  }) as unknown as typeof fetch;
}

describe('fetchEcrituresTvaCompletes — intégration bout-en-bout sur le cas réel Rousseau', () => {
  it('compose la ligne TVA avec sa contrepartie client, nom réel et lettrage réel', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchRouteur() });

    const resultat = await fetchEcrituresTvaCompletes(client, {
      comptesTva: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
    });

    expect(resultat).toHaveLength(1);

    const [ecriture] = resultat;
    expect(ecriture?.ligneTva.compte).toBe('445711');
    expect(ecriture?.ligneTva.credit).toBe(711.03);
    expect(ecriture?.ledgerEntryId).toBe(22495307276288);

    // Le compte produit (7061) a été exclu de lignesTiers (non lettrable),
    // mais ne doit PAS avoir disparu : il est nécessaire au futur contrôle
    // bien/service du Module 4.
    expect(ecriture?.lignesTiers).toHaveLength(1);
    expect(ecriture?.autresLignes).toHaveLength(1);
    expect(ecriture?.autresLignes[0]?.compte).toBe('7061');
    expect(ecriture?.autresLignes[0]?.credit).toBe(3555.14);

    const [ligneTiers] = ecriture?.lignesTiers ?? [];
    expect(ligneTiers?.compte).toBe('411ROUSSEAU');
    expect(ligneTiers?.libelleCompte).toBe('CLIENT ROUSSEAU'); // nom réel, pas le texte libre de la ligne
    expect(ligneTiers?.debit).toBe(4266.17);
    expect(ligneTiers?.lettrage.estLettree).toBe(true);
    expect(ligneTiers?.lettrage.groupeIds).toEqual([92522390130688, 92522389336064]);
  });

  it('retourne un tableau vide sans erreur si aucune ligne TVA sur la période', async () => {
    const comptesTva = loadFixture('ledger_accounts_tva.json');
    const fetchImpl = (async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname === '/api/external/v2/ledger_accounts') {
        return new Response(JSON.stringify(comptesTva), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });
    const resultat = await fetchEcrituresTvaCompletes(client, {
      comptesTva: ['445711'],
      periodeDebut: '2025-02-01',
      periodeFin: '2025-02-28',
    });

    expect(resultat).toEqual([]);
  });
});
