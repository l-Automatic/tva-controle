import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool, avecContexteCabinet } from '../src/db/pool.js';
import { verifierAutoliquidationLegere } from '../src/verifierAutoliquidationLegere.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

let CABINET_ID = '';
let DOSSIER_ID = '';

const pool = creerPool(CONNECTION_STRING);
const PERIODE_DEBUT = '2025-08-01';
const PERIODE_FIN = '2025-08-31';

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const cabinetRes = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet test verif autoliq ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test verif autoliq', 'reel_normal', 'pennylane', 'sandbox-verif-autoliq', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = dossierRes.rows[0]!.id;

    // Compte due confirmé, sans son pendant déductible confirmé — la paire
    // BTP doit donc être ignorée (jamais tourner sur une confirmation
    // partielle), exactement comme le cycle complet.
    await client.query(
      `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source)
       VALUES ($1, 'compte_tva_due_autoliquidee', '"4454"'::jsonb, 'confirmed', 'onboarding')`,
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

describe('verifierAutoliquidationLegere', () => {
  it('ne fait rien planter si un seul des deux comptes d’une paire est confirmé (jamais tourner sur une confirmation partielle)', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });
    const resultat = await verifierAutoliquidationLegere(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: PERIODE_DEBUT,
      periodeFin: PERIODE_FIN,
    });
    expect(resultat.anomaliesOuvertes).toBe(0);

    const anomalies = await avecContexteCabinet(pool, CABINET_ID, (c) =>
      c.query(`SELECT * FROM anomalies WHERE dossier_id = $1 AND type_anomalie = 'autoliquidation_desequilibree'`, [
        DOSSIER_ID,
      ])
    );
    expect(anomalies.rows).toEqual([]);
  });
});
