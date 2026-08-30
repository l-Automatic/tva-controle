import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool, avecContexteCabinet } from '../src/db/pool.js';
import { enregistrerAnomalies } from '../src/db/writeRepository.js';
import { listerAnomalies } from '../src/db/readRepository.js';
import { verifierComptesNonReconnus } from '../src/verifierComptesNonReconnus.js';

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
      `Cabinet test verif comptes non reconnus ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test verif legere', 'reel_normal', 'pennylane', 'sandbox-verif-legere', true)
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

// Balance vide : aucun compte 445xx avec mouvement — le cas le plus simple,
// vérifie que toute la chaîne (balance -> découverte -> écritures -> détection
// -> persistance) s'exécute sans erreur même quand il n'y a rien à trouver.
function fakeFetchBalanceVide(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 })) as unknown as typeof fetch;
}

describe('verifierComptesNonReconnus', () => {
  it('se déroule sans erreur quand la balance ne montre aucun compte 445xx avec mouvement', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });

    const resultat = await verifierComptesNonReconnus(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
    });

    expect(resultat).toEqual({ anomalies: 0 });
  });

  it('ne touche JAMAIS une anomalie d’un autre type déjà enregistrée pour la même période — le vrai risque de ce mécanisme', async () => {
    const periode = '2025-02-01';
    await avecContexteCabinet(pool, CABINET_ID, (dbClient) =>
      enregistrerAnomalies(dbClient, DOSSIER_ID, periode, [
        {
          type: 'nouveau_tiers_a_verifier',
          gravite: 'signale',
          ledgerEntryId: 999,
          compte: '411AUTRE',
          description: 'jamais réexaminé par verifierComptesNonReconnus',
        },
      ])
    );

    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });
    await verifierComptesNonReconnus(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: periode,
      periodeFin: '2025-02-28',
    });

    const liste = await avecContexteCabinet(pool, CABINET_ID, (dbClient) =>
      listerAnomalies(dbClient, DOSSIER_ID, { periode })
    );
    const autreType = liste.find((a) => a.typeAnomalie === 'nouveau_tiers_a_verifier');
    expect(autreType?.statut).toBe('ouvert'); // toujours intacte, jamais marquée obsolete
  });
});
