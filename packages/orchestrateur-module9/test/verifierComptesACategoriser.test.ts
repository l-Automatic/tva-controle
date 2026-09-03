import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { verifierComptesACategoriser } from '../src/verifierComptesACategoriser.js';

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
  try {
    await client.query('BEGIN');
    const cabinetRes = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet test verif categorisation ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test verif categorisation', 'reel_normal', 'pennylane', 'sandbox-verif-categ', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = dossierRes.rows[0]!.id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await provisioningPool.end();
  }
});

afterAll(async () => {
  await pool.end();
});

function fakeFetchBalanceVide(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 })) as unknown as typeof fetch;
}

describe('verifierComptesACategoriser', () => {
  it('retourne une liste vide quand la balance ne montre aucun compte TVA avec mouvement (rien à catégoriser)', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });

    const resultat = await verifierComptesACategoriser(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
    });

    expect(resultat).toEqual([]);
  });
});
