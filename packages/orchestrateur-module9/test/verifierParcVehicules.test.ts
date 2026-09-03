import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { verifierParcVehicules } from '../src/verifierParcVehicules.js';

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
      `Cabinet test verif parc ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test verif parc', 'reel_normal', 'pennylane', 'sandbox-verif-parc', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = dossierRes.rows[0]!.id;

    // Convention comptes_carburant confirmée, sans quoi la fonction sort
    // toujours false avant même de vérifier quoi que ce soit.
    await client.query(
      `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut) VALUES ($1, 'comptes_carburant', '["6061"]'::jsonb, 'confirmed')`,
      [DOSSIER_ID]
    );

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

describe('verifierParcVehicules', () => {
  it('retourne false si aucun compte 445xx n’a de mouvement (rien à vérifier)', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });
    const bloque = await verifierParcVehicules(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: '2025-04-01',
      periodeFin: '2025-04-30',
    });
    expect(bloque).toBe(false);
  });
});
