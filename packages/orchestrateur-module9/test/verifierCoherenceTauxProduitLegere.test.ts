import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { verifierCoherenceTauxProduitLegere } from '../src/verifierCoherenceTauxProduitLegere.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

const pool = creerPool(CONNECTION_STRING);

function fakeFetchBalanceVide(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 })) as unknown as typeof fetch;
}

describe('verifierCoherenceTauxProduitLegere', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('retourne 0 anomalie ouverte quand la balance ne montre aucun mouvement', async () => {
    const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
    const provClient = await provisioningPool.connect();
    let cabinetId = '';
    let dossierId = '';
    try {
      await provClient.query('BEGIN');
      const cabinetRes = await provClient.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
        `Cabinet test verif taux produit ${Date.now()}`,
      ]);
      cabinetId = cabinetRes.rows[0]!.id;
      await provClient.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      const dossierRes = await provClient.query<{ id: string }>(
        `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
         VALUES ($1, 'Dossier test taux produit', 'reel_normal', 'pennylane', 'sandbox-taux-produit', true)
         RETURNING id`,
        [cabinetId]
      );
      dossierId = dossierRes.rows[0]!.id;
      await provClient.query('COMMIT');
    } catch (err) {
      await provClient.query('ROLLBACK');
      throw err;
    } finally {
      provClient.release();
      await provisioningPool.end();
    }

    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });
    const resultat = await verifierCoherenceTauxProduitLegere(pool, {
      cabinetId,
      dossierId,
      client,
      periodeDebut: '2025-08-01',
      periodeFin: '2025-08-31',
    });
    expect(resultat.anomaliesOuvertes).toBe(0);
  });
});
