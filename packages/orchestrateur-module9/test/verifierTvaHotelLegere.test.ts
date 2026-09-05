import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool, avecContexteCabinet } from '../src/db/pool.js';
import { verifierTvaHotelLegere } from '../src/verifierTvaHotelLegere.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

let CABINET_ID = '';
let DOSSIER_ID = '';
let UTILISATEUR_ID = '';
let CALCUL_ID = '';

const pool = creerPool(CONNECTION_STRING);
const PERIODE_DEBUT = '2025-07-01';
const PERIODE_FIN = '2025-07-31';

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const cabinetRes = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet test verif tva hotel ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test verif tva hotel', 'reel_normal', 'pennylane', 'sandbox-verif-hotel', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = dossierRes.rows[0]!.id;

    const utilisateurRes = await client.query<{ id: string }>(
      `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Test hotel', $2, 'collaborateur') RETURNING id`,
      [CABINET_ID, `test-hotel-${Date.now()}@test.fr`]
    );
    UTILISATEUR_ID = utilisateurRes.rows[0]!.id;

    const calculRes = await client.query<{ id: string }>(
      `INSERT INTO calculs_tva (dossier_id, periode_debut, periode_fin, tva_nette, sens)
       VALUES ($1, $2, $3, 800, 'a_decaisser') RETURNING id`,
      [DOSSIER_ID, PERIODE_DEBUT, PERIODE_FIN]
    );
    CALCUL_ID = calculRes.rows[0]!.id;
    await client.query(
      `INSERT INTO calculs_tva_lignes (calcul_id, categorie, montant, nb_ecritures_source) VALUES ($1, 'deductible_abs', 1500, 8)`,
      [CALCUL_ID]
    );

    // Anomalie déjà confirmée (qualifierTvaHotel('confirme')) — 60€ de TVA
    // à retirer une fois la correction constatée.
    await client.query(
      `INSERT INTO anomalies (dossier_id, periode, type_anomalie, gravite, reference_piece, description, statut, details)
       VALUES ($1, $2, 'tva_hotel_a_verifier', 'signale', '4001', 'test', 'resolu', $3::jsonb)`,
      [DOSSIER_ID, PERIODE_DEBUT, JSON.stringify({ montantTva: 60, confiance: 'haute', justification: 'test' })]
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

describe('verifierTvaHotelLegere', () => {
  it('tva_hotel_a_verifier confirmée : corrige et marque obsolete une fois la TVA constatée retirée (balance vide = plus déduite)', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });
    const params = {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: PERIODE_DEBUT,
      periodeFin: PERIODE_FIN,
      utilisateurId: UTILISATEUR_ID,
    };

    const resultat = await verifierTvaHotelLegere(pool, params);
    expect(resultat.corrections).toBe(1);

    const ajustement = await avecContexteCabinet(pool, CABINET_ID, (c) =>
      c.query<{ montant_ajuste: string }>(
        `SELECT montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = 'deductible_abs'`,
        [CALCUL_ID]
      )
    );
    expect(Number.parseFloat(ajustement.rows[0]!.montant_ajuste)).toBe(1440); // 1500 - 60

    const anomalie = await avecContexteCabinet(pool, CABINET_ID, (c) =>
      c.query<{ statut: string }>(`SELECT statut FROM anomalies WHERE reference_piece = '4001'`)
    );
    expect(anomalie.rows[0]?.statut).toBe('obsolete');

    // Second appel : ne doit rien rejouer (l'anomalie n'est plus 'resolu', donc plus jamais reprise).
    const secondAppel = await verifierTvaHotelLegere(pool, params);
    expect(secondAppel.corrections).toBe(0);
    const ajustementApresSecond = await avecContexteCabinet(pool, CABINET_ID, (c) =>
      c.query<{ montant_ajuste: string }>(
        `SELECT montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = 'deductible_abs'`,
        [CALCUL_ID]
      )
    );
    expect(Number.parseFloat(ajustementApresSecond.rows[0]!.montant_ajuste)).toBe(1440); // inchangé
  });
});
