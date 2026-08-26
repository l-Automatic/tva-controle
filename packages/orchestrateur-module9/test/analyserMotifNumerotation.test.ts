import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { definirParametreCabinet } from '../src/db/writeRepository.js';
import { analyserMotifNumerotationFacture, ClefMistralAbsenteError } from '../src/analyserMotifNumerotation.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

let CABINET_ID = '';
let DOSSIER_ID = '';

const pool = creerPool(CONNECTION_STRING);

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  const cabinetRes = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
    `Cabinet test motif numerotation ${Date.now()}`,
  ]);
  CABINET_ID = cabinetRes.rows[0]!.id;

  await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);
  const dossierRes = await client.query<{ id: string }>(
    `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
     VALUES ($1, 'Dossier test motif numerotation', 'reel_normal', 'pennylane', 'sandbox-motif-num', true)
     RETURNING id`,
    [CABINET_ID]
  );
  DOSSIER_ID = dossierRes.rows[0]!.id;
  client.release();
  await provisioningPool.end();
});

afterAll(async () => {
  await pool.end();
});

function fakeFetchRouteur(): typeof fetch {
  return (async (rawUrl: string) => {
    const url = new URL(rawUrl);
    if (url.pathname === '/api/external/v2/ledger_accounts') {
      return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('analyserMotifNumerotationFacture', () => {
  it('lève ClefMistralAbsenteError si aucune clé Mistral n’est configurée pour ce cabinet', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchRouteur() });

    await expect(
      analyserMotifNumerotationFacture(pool, {
        cabinetId: CABINET_ID,
        dossierId: DOSSIER_ID,
        client,
        periodeDebut: '2025-01-01',
        periodeFin: '2025-12-31',
        utilisateurId: 'peu-importe',
      })
    ).rejects.toThrow(ClefMistralAbsenteError);
  });

  it('retourne motifPropose: null si aucun compte de collecte n’est découvert', async () => {
    await avecContexteCabinetTest(async (dbClient) => {
      await definirParametreCabinet(dbClient, CABINET_ID, 'mistral_api_key', 'une-cle-de-test', 'peu-importe');
    });

    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchRouteur() });
    const resultat = await analyserMotifNumerotationFacture(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: '2025-01-01',
      periodeFin: '2025-12-31',
      utilisateurId: 'peu-importe',
    });

    expect(resultat).toEqual({ motifPropose: null });
  });
});

async function avecContexteCabinetTest(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);
    await fn(client);
  } finally {
    client.release();
  }
}
