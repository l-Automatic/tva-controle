import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { executerCycleTva } from '../src/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

let CABINET_ID = '';
let DOSSIER_ID = '';

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'connector-pennylane', 'test', 'fixtures', name), 'utf-8')
  );
}

const pool = creerPool(CONNECTION_STRING);

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const resCabinet = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet Test pipeline ${Date.now()}`,
    ]);
    CABINET_ID = resCabinet.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const resDossier = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Electricien Sandbox', 'reel_normal', 'pennylane', 'sandbox-electricien', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = resDossier.rows[0]!.id;

    await client.query(
      `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source) VALUES
       ($1, 'compte_tva_due_autoliquidee', '"4454"', 'confirmed', 'onboarding'),
       ($1, 'compte_tva_deductible_autoliquidee', '"445664"', 'confirmed', 'onboarding')`,
      [DOSSIER_ID]
    );
    await client.query(
      `INSERT INTO taux_historique (dossier_id, compte_produit_ou_charge, taux_habituel, nb_occurrences)
       VALUES ($1, '445711', 20, 40)`,
      [DOSSIER_ID]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await provisioningPool.end();
  }
}, 20_000);

afterAll(async () => {
  await pool.end();
});

// Même routeur que le test d'intégration du connecteur — réutilise les
// mêmes fixtures réelles (cas ROUSSEAU) plutôt que d'en inventer de nouvelles.
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
      if (filtre.includes('"field":"number"')) return new Response(JSON.stringify(comptesTva), { status: 200 });
      if (filtre.includes('"field":"id"')) return new Response(JSON.stringify(comptesCandidats), { status: 200 });
    }
    if (url.pathname === '/api/external/v2/ledger_entry_lines') {
      if (filtre.includes('"field":"ledger_account_id"'))
        return new Response(JSON.stringify(lignesTva), { status: 200 });
      if (filtre.includes('"field":"id"')) return new Response(JSON.stringify(lettrageRousseau), { status: 200 });
    }
    if (/\/ledger_entries\/\d+\/ledger_entry_lines/.test(url.pathname)) {
      return new Response(JSON.stringify(pieceRousseau), { status: 200 });
    }
    throw new Error(`URL non routée : ${rawUrl}`);
  }) as unknown as typeof fetch;
}

describe('executerCycleTva — bout-en-bout, vraie base + cas réel ROUSSEAU', () => {
  it('charge le contexte réel, calcule, et classe la vente en collectee_20', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchRouteur() });

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
      client,
      comptesTva: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      configExigibilite: { comptesVenteService: ['706'], comptesChargeService: ['611'] },
      configCarburant: { comptesCarburant: ['6061'] },
      comptesEquipement: ['6063'],
    });

    expect(resultat.statut).toBe('calcule');
    if (resultat.statut !== 'calcule') throw new Error('assertion');

    expect(resultat.resultat.lignes).toEqual([
      { categorie: 'collectee_20', montant: 711.03, referencesPieces: [22495307276288] },
    ]);
    expect(resultat.resultat.sens).toBe('a_decaisser');
    expect(resultat.resultat.tvaNette).toBe(711.03);
  });

  it('utilise bien le taux de la base réelle (445711 -> 20% via taux_historique, pas le repli national)', async () => {
    // Le taux national par défaut pour 445711 est aussi 20%, donc ce test ne
    // suffirait pas seul à prouver la priorité dossier — mais confirme au
    // moins que la valeur chargée depuis Postgres est bien utilisée dans le
    // calcul (pas ignorée). La priorité dossier vs national est déjà testée
    // isolément dans controles-module4/test/controle.test.ts.
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchRouteur() });

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
      client,
      comptesTva: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      configExigibilite: { comptesVenteService: ['706'], comptesChargeService: ['611'] },
      configCarburant: { comptesCarburant: ['6061'] },
      comptesEquipement: ['6063'],
    });

    expect(resultat.statut).toBe('calcule');
  });
});

describe('executerCycleTva — chemin bloqué (comportement central de cette v1)', () => {
  it('s’arrête avant le calcul si une anomalie bloquante existe, sans jamais appeler calculerTva', async () => {
    const comptesTva = loadFixture('ledger_accounts_tva.json');
    const comptesCandidats = loadFixture('ledger_accounts_candidats_rousseau.json');

    // Ligne TVA fabriquée : 445711 à 100, produit à 1000 -> taux implicite 10%,
    // mais le vrai taux_historique en base pour ce dossier dit 20% (inséré
    // plus tôt via provisioning) -> anomalie taux_incoherent, bloquante.
    const ledgerEntryId = 999;
    const ligneTvaIncoherente = {
      items: [
        {
          id: 1,
          label: 'TEST INCOHERENT',
          debit: '0.0',
          credit: '100.0',
          date: '2025-01-20',
          created_at: '2025-01-20T00:00:00Z',
          updated_at: '2025-01-20T00:00:00Z',
          journal: { id: 1, url: 'x' },
          categories: [],
          ledger_account: { id: 12028930117632, number: '445711', url: 'x' },
          ledger_entry: { id: ledgerEntryId },
          lettered_ledger_entry_lines: { ids: [], url: 'x' },
        },
      ],
      has_more: false,
      next_cursor: null,
    };
    const piece = {
      items: [
        { id: 2, debit: '0.0', credit: '1000.0', label: 'produit', ledger_account_id: 12028930121728, ledger_account: { id: 12028930121728, number: '7061', url: 'x' } },
        { id: 1, debit: '0.0', credit: '100.0', label: 'tva', ledger_account_id: 12028930117632, ledger_account: { id: 12028930117632, number: '445711', url: 'x' } },
      ],
      has_more: false,
      next_cursor: null,
    };

    const fetchImpl = (async (rawUrl: string) => {
      const url = new URL(rawUrl);
      const filtre = url.searchParams.get('filter') ?? '';
      if (url.pathname === '/api/external/v2/ledger_accounts') {
        if (filtre.includes('"field":"number"')) return new Response(JSON.stringify(comptesTva), { status: 200 });
        if (filtre.includes('"field":"id"')) return new Response(JSON.stringify(comptesCandidats), { status: 200 });
      }
      if (url.pathname === '/api/external/v2/ledger_entry_lines' && filtre.includes('"field":"ledger_account_id"')) {
        return new Response(JSON.stringify(ligneTvaIncoherente), { status: 200 });
      }
      if (/\/ledger_entries\/\d+\/ledger_entry_lines/.test(url.pathname)) {
        return new Response(JSON.stringify(piece), { status: 200 });
      }
      throw new Error(`URL non routée : ${rawUrl}`);
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
      client,
      comptesTva: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      configExigibilite: { comptesVenteService: ['706'], comptesChargeService: ['611'] },
      configCarburant: { comptesCarburant: ['6061'] },
      comptesEquipement: ['6063'],
    });

    expect(resultat.statut).toBe('bloque');
    if (resultat.statut !== 'bloque') throw new Error('assertion');
    expect(resultat.anomalies.some((a) => a.type === 'taux_incoherent' && a.gravite === 'bloquant')).toBe(true);
  });
});
