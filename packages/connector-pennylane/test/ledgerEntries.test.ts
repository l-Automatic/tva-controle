import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PennylaneClient } from '../src/connectors/pennylane/client.js';
import { resolveLedgerAccounts, resolveLedgerAccountsByIds, decouvrirComptesParPrefixe } from '../src/connectors/pennylane/ledgerAccounts.js';
import { fetchLignesParCompte } from '../src/connectors/pennylane/tvaLedgerLines.js';
import { fetchLignesDePiece } from '../src/connectors/pennylane/pieceLines.js';
import { fetchLettrage } from '../src/connectors/pennylane/lettering.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

function fakeFetch(response: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(response), { status })) as unknown as typeof fetch;
}

describe('resolveLedgerAccounts — comptes TVA réels du dossier sandbox', () => {
  it('résout les 7 comptes TVA vers leurs id internes, avec leur statut lettrable', async () => {
    const fixture = loadFixture('ledger_accounts_tva.json');
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetch(fixture) });

    const comptes = await resolveLedgerAccounts(client, [
      '44562', '44566', '445664', '445711', '445712', '445713', '4454',
    ]);

    expect(comptes.size).toBe(7);
    expect(comptes.get('445711')).toEqual({
      id: 12028930117632,
      numero: '445711',
      libelle: 'TVA COLLECTÉE 20%',
      lettrable: true,
    });
    // Point métier vérifié : même les comptes d'autoliquidation sont lettrables
    // dans ce dossier — surprenant par rapport à l'hypothèse initiale.
    expect(comptes.get('4454')?.lettrable).toBe(true);
    expect(comptes.get('445664')?.lettrable).toBe(true);
  });
});

describe('fetchLignesParCompte — lignes réelles sur les comptes TVA (janvier 2025)', () => {
  it('parse 50 lignes réelles, aucune n’est lettrée au niveau du compte TVA lui-même', async () => {
    const fixture = loadFixture('ledger_entry_lines_tva_page1.json') as { has_more: boolean };
    // On force has_more à false pour ce test ciblé sur une seule page
    const fixtureUnePage = { ...fixture, has_more: false, next_cursor: null };
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetch(fixtureUnePage) });

    const lignes = await fetchLignesParCompte(client, {
      compteIds: [12028930117632, 12028930088960, 12028930207744, 12021345099776, 12021345034240, 12028930183168, 12028930187264],
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
    });

    expect(lignes).toHaveLength(50);
    // Confirmation métier : sur données réelles, aucune ligne TVA (445xx/4454) n'est lettrée.
    expect(lignes.every((l) => l.lettrage.estLettree === false)).toBe(true);

    const ligneRousseau = lignes.find((l) => l.id === 92522389344256);
    expect(ligneRousseau).toBeDefined();
    expect(ligneRousseau?.compte).toBe('445711');
    expect(ligneRousseau?.credit).toBe(711.03);
    expect(ligneRousseau?.ledgerEntryId).toBe(22495307276288);
  });

  it('suit la pagination cursor jusqu’à has_more: false', async () => {
    const page1 = loadFixture('ledger_entry_lines_tva_page1.json') as {
      items: unknown[];
      has_more: boolean;
      next_cursor: string;
    };
    const page2 = { items: [], has_more: false, next_cursor: null };

    let call = 0;
    const fetchImpl = (async (url: string) => {
      call += 1;
      if (call === 1) {
        expect(url).not.toContain('cursor=');
        return new Response(JSON.stringify(page1), { status: 200 });
      }
      expect(url).toContain(`cursor=${encodeURIComponent(page1.next_cursor)}`);
      return new Response(JSON.stringify(page2), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });
    const lignes = await fetchLignesParCompte(client, {
      compteIds: [12028930117632],
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
    });

    expect(call).toBe(2);
    expect(lignes).toHaveLength(page1.items.length);
  });

  it('transmet le filtre compte + date correctement encodé', async () => {
    let capturedUrl = '';
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });
    await fetchLignesParCompte(client, {
      compteIds: [111, 222],
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
    });

    const decoded = decodeURIComponent(capturedUrl);
    expect(decoded).toContain('"field":"ledger_account_id"');
    expect(decoded).toContain('"operator":"in"');
    expect(decoded).toContain('"value":[111,222]');
    expect(decoded).toContain('"field":"date","operator":"gteq","value":"2025-01-01"');
    expect(decoded).toContain('"field":"date","operator":"lteq","value":"2025-01-31"');
  });
});

describe('fetchLignesDePiece — pièce ROUSSEAU réelle (3 lignes : produit, TVA, client)', () => {
  it('retrouve les 3 lignes de la pièce, dont la ligne client 411ROUSSEAU', async () => {
    const fixture = loadFixture('piece_rousseau_lines.json');
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetch(fixture) });

    const lignes = await fetchLignesDePiece(client, 22495307276288);

    expect(lignes).toHaveLength(3);
    const ligneClient = lignes.find((l) => l.compte === '411ROUSSEAU');
    expect(ligneClient).toBeDefined();
    expect(ligneClient?.debit).toBe(4266.17);
    expect(ligneClient?.id).toBe(92522389336064);

    const ligneTva = lignes.find((l) => l.compte === '445711');
    expect(ligneTva?.credit).toBe(711.03);

    const ligneProduit = lignes.find((l) => l.compte === '7061');
    expect(ligneProduit?.credit).toBe(3555.14);
  });
});

describe('fetchLettrage — cas réel positif (ligne effectivement lettrée)', () => {
  it('détecte une ligne lettrée avec son groupe de rapprochement complet', async () => {
    const fixture = loadFixture('lettering_rousseau_lettree.json');
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetch(fixture) });

    const lettrage = await fetchLettrage(client, [92522389336064]);

    const resultat = lettrage.get(92522389336064);
    expect(resultat).toBeDefined();
    expect(resultat?.estLettree).toBe(true);
    expect(resultat?.groupeIds).toEqual([92522390130688, 92522389336064]);
  });

  it('détecte une ligne non lettrée (cas négatif, sur une ligne TVA réelle)', async () => {
    const fixture = {
      items: [
        {
          id: 92522389344256,
          label: 'ROUSSEAU VIR 21/01',
          debit: '0.0',
          credit: '711.03',
          date: '2025-01-21',
          created_at: '2026-06-04T14:36:05.897572Z',
          updated_at: '2026-06-04T14:36:06.947278Z',
          journal: { id: 80826900480, url: 'x' },
          ledger_account: { id: 12028930117632, number: '445711', url: 'x' },
          ledger_entry: { id: 22495307276288 },
          lettered_ledger_entry_lines: { ids: [], url: 'x' },
        },
      ],
      has_more: false,
      next_cursor: null,
    };
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetch(fixture) });

    const lettrage = await fetchLettrage(client, [92522389344256]);
    expect(lettrage.get(92522389344256)?.estLettree).toBe(false);
    expect(lettrage.get(92522389344256)?.groupeIds).toEqual([]);
  });

  it('retourne une map vide sans appel réseau si aucun id fourni', async () => {
    let appelE = false;
    const fetchImpl = (async () => {
      appelE = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const lettrage = await fetchLettrage(client, []);
    expect(lettrage.size).toBe(0);
    expect(appelE).toBe(false);
  });
});

describe('resolveLedgerAccountsByIds — libellé réel du compte client Rousseau', () => {
  it('récupère le libellé (nom de tiers en pratique) à partir de l’id découvert dans une pièce', async () => {
    const fixture = loadFixture('ledger_account_by_id_rousseau.json');
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetch(fixture) });

    const comptes = await resolveLedgerAccountsByIds(client, [12028930322432]);

    const compte = comptes.get(12028930322432);
    expect(compte).toBeDefined();
    expect(compte?.numero).toBe('411ROUSSEAU');
    expect(compte?.libelle).toBe('CLIENT ROUSSEAU');
    expect(compte?.lettrable).toBe(true);
  });

  it('retourne une map vide sans appel réseau si aucun id fourni', async () => {
    let appelE = false;
    const fetchImpl = (async () => {
      appelE = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const comptes = await resolveLedgerAccountsByIds(client, []);
    expect(comptes.size).toBe(0);
    expect(appelE).toBe(false);
  });

  it('suit la pagination — bug réel trouvé sur le dossier électricien : un compte sur la 2e page était silencieusement perdu sans ça', async () => {
    // Rousseau sur la page 1, GARNIER (vraie donnée du dossier réel, id et
    // libellé confirmés en conditions réelles) sur la page 2 — reproduit
    // exactement le scénario qui a corrompu le calcul en production : sans
    // pagination, GARNIER n'apparaissait jamais dans la map retournée.
    const page1 = {
      total_pages: null, current_page: null, per_page: null, total_items: null,
      items: [
        { id: 12028930322432, number: '411ROUSSEAU', label: 'CLIENT ROUSSEAU', vat_rate: 'any', country_alpha2: 'any', enabled: true, created_at: 'x', updated_at: 'x', type: 'customer', letterable: true },
      ],
      has_more: true,
      next_cursor: 'cursor-page-2',
    };
    const page2 = {
      total_pages: null, current_page: null, per_page: null, total_items: null,
      items: [
        { id: 12028930301952, number: '411GARNIER', label: 'CLIENT GARNIER', vat_rate: 'any', country_alpha2: 'any', enabled: true, created_at: 'x', updated_at: 'x', type: 'customer', letterable: true },
      ],
      has_more: false,
      next_cursor: null,
    };

    let appel = 0;
    const fetchImpl = (async (url: string) => {
      appel += 1;
      if (appel === 1) {
        expect(url).not.toContain('cursor=');
        return new Response(JSON.stringify(page1), { status: 200 });
      }
      expect(url).toContain('cursor=cursor-page-2');
      return new Response(JSON.stringify(page2), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });
    const comptes = await resolveLedgerAccountsByIds(client, [12028930322432, 12028930301952]);

    expect(appel).toBe(2);
    expect(comptes.size).toBe(2);
    expect(comptes.get(12028930301952)).toMatchObject({ numero: '411GARNIER', lettrable: true });
  });
});

describe('decouvrirComptesParPrefixe', () => {
  it('envoie bien l’opérateur start_with avec le préfixe demandé', async () => {
    const fixture = loadFixture('ledger_accounts_tva.json');
    let capturedUrl = '';
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const comptes = await decouvrirComptesParPrefixe(client, '445');

    const decoded = decodeURIComponent(capturedUrl);
    expect(decoded).toContain('"field":"number"');
    expect(decoded).toContain('"operator":"start_with"');
    expect(decoded).toContain('"value":"445"');
    expect(comptes).toHaveLength(7); // fixture réelle : les 7 comptes TVA du dossier sandbox
  });

  it('suit la pagination cursor comme les autres fonctions du connecteur', async () => {
    const fixtureComplete = loadFixture('ledger_accounts_tva.json') as { items: unknown[] };
    const page1 = {
      items: fixtureComplete.items.slice(0, 3),
      has_more: true,
      next_cursor: 'cursor-onboarding-page-2',
    };
    const page2 = { items: fixtureComplete.items.slice(3), has_more: false, next_cursor: null };

    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      return new Response(JSON.stringify(call === 1 ? page1 : page2), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const comptes = await decouvrirComptesParPrefixe(client, '445');
    expect(call).toBe(2);
    expect(comptes).toHaveLength(7);
  });
});
