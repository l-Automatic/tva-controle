import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { avecContexteCabinet } from '../src/db/pool.js';
import { verifierImmobilisationLegere } from '../src/verifierImmobilisationLegere.js';

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
const PERIODE_DEBUT = '2025-06-01';
const PERIODE_FIN = '2025-06-30';

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const cabinetRes = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet test verif immob ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test verif immob', 'reel_normal', 'pennylane', 'sandbox-verif-immob', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = dossierRes.rows[0]!.id;

    const utilisateurRes = await client.query<{ id: string }>(
      `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Test immob', $2, 'collaborateur') RETURNING id`,
      [CABINET_ID, `test-immob-${Date.now()}@test.fr`]
    );
    UTILISATEUR_ID = utilisateurRes.rows[0]!.id;

    // Calcul brouillon avec deux lignes : 2000€ en charges (deductible_abs),
    // 500€ déjà en immobilisations (deductible_immo).
    const calculRes = await client.query<{ id: string }>(
      `INSERT INTO calculs_tva (dossier_id, periode_debut, periode_fin, tva_nette, sens)
       VALUES ($1, $2, $3, 1500, 'a_decaisser') RETURNING id`,
      [DOSSIER_ID, PERIODE_DEBUT, PERIODE_FIN]
    );
    CALCUL_ID = calculRes.rows[0]!.id;
    await client.query(
      `INSERT INTO calculs_tva_lignes (calcul_id, categorie, montant, nb_ecritures_source) VALUES ($1, 'deductible_abs', 2000, 5)`,
      [CALCUL_ID]
    );
    await client.query(
      `INSERT INTO calculs_tva_lignes (calcul_id, categorie, montant, nb_ecritures_source) VALUES ($1, 'deductible_immo', 500, 1)`,
      [CALCUL_ID]
    );

    // Anomalie déjà qualifiée "confirme_immo" (statut résolu), montant 800€
    // à transférer — reference_piece 9001 ne touchera plus aucun compte
    // 445xx côté Pennylane (fake client vide), donc plus candidate.
    await client.query(
      `INSERT INTO anomalies (dossier_id, periode, type_anomalie, gravite, reference_piece, description, statut, details)
       VALUES ($1, $2, 'immobilisation_potentielle_non_passee', 'signale', '9001', 'test', 'resolu', $3::jsonb)`,
      [DOSSIER_ID, PERIODE_DEBUT, JSON.stringify({ lignes: [{ compte: '6063', montant: 800, libelle: 'test' }] })]
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

describe('verifierImmobilisationLegere', () => {
  it('applique le transfert une seule fois — un second appel identique ne rejoue jamais la correction (bug réel corrigé, trouvé par Claude Code)', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });
    const params = {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: PERIODE_DEBUT,
      periodeFin: PERIODE_FIN,
      utilisateurId: UTILISATEUR_ID,
    };

    const premierAppel = await verifierImmobilisationLegere(pool, params);
    expect(premierAppel.corrections).toBe(1);

    const ajustementsApresPremier = await avecContexteCabinet(pool, CABINET_ID, (client) =>
      client.query<{ type_montant: string; montant_ajuste: string }>(
        `SELECT type_montant, montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 ORDER BY type_montant`,
        [CALCUL_ID]
      )
    );
    expect(ajustementsApresPremier.rows).toHaveLength(2);
    const abs = ajustementsApresPremier.rows.find((r) => r.type_montant === 'deductible_abs');
    const immo = ajustementsApresPremier.rows.find((r) => r.type_montant === 'deductible_immo');
    expect(Number.parseFloat(abs!.montant_ajuste)).toBe(1200); // 2000 - 800
    expect(Number.parseFloat(immo!.montant_ajuste)).toBe(1300); // 500 + 800

    // Deuxième appel, données Pennylane identiques : ne doit RIEN rejouer.
    const deuxiemeAppel = await verifierImmobilisationLegere(pool, params);
    expect(deuxiemeAppel.corrections).toBe(0);

    const ajustementsApresSecond = await avecContexteCabinet(pool, CABINET_ID, (client) =>
      client.query<{ montant_ajuste: string }>(
        `SELECT montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = 'deductible_abs'`,
        [CALCUL_ID]
      )
    );
    expect(Number.parseFloat(ajustementsApresSecond.rows[0]!.montant_ajuste)).toBe(1200); // inchangé, pas 400

    const anomalie = await avecContexteCabinet(pool, CABINET_ID, (client) =>
      client.query<{ statut: string }>(`SELECT statut FROM anomalies WHERE reference_piece = '9001'`)
    );
    expect(anomalie.rows[0]?.statut).toBe('obsolete');
  });
});
