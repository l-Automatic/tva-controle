import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool, avecContexteCabinet } from '../src/db/pool.js';
import { verifierFraisVehiculeLegere } from '../src/verifierFraisVehiculeLegere.js';

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
const PERIODE_DEBUT = '2025-09-01';
const PERIODE_FIN = '2025-09-30';

function fakeFetchBalanceVide(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 })) as unknown as typeof fetch;
}

describe('verifierFraisVehiculeLegere', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('couvre les deux types confirmés en un seul appel : corrige et marque obsolete une fois la TVA constatée retirée', async () => {
    const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
    const provClient = await provisioningPool.connect();
    try {
      await provClient.query('BEGIN');
      const cabinetRes = await provClient.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
        `Cabinet test verif frais vehicule ${Date.now()}`,
      ]);
      CABINET_ID = cabinetRes.rows[0]!.id;
      await provClient.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

      const dossierRes = await provClient.query<{ id: string }>(
        `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
         VALUES ($1, 'Dossier test frais vehicule', 'reel_normal', 'pennylane', 'sandbox-frais-vehicule', true)
         RETURNING id`,
        [CABINET_ID]
      );
      DOSSIER_ID = dossierRes.rows[0]!.id;

      const utilisateurRes = await provClient.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Test frais vehicule', $2, 'collaborateur') RETURNING id`,
        [CABINET_ID, `test-frais-vehicule-${Date.now()}@test.fr`]
      );
      UTILISATEUR_ID = utilisateurRes.rows[0]!.id;

      const calculRes = await provClient.query<{ id: string }>(
        `INSERT INTO calculs_tva (dossier_id, periode_debut, periode_fin, tva_nette, sens)
         VALUES ($1, $2, $3, 500, 'a_decaisser') RETURNING id`,
        [DOSSIER_ID, PERIODE_DEBUT, PERIODE_FIN]
      );
      CALCUL_ID = calculRes.rows[0]!.id;
      await provClient.query(
        `INSERT INTO calculs_tva_lignes (calcul_id, categorie, montant, nb_ecritures_source) VALUES ($1, 'deductible_abs', 800, 4)`,
        [CALCUL_ID]
      );

      // Deux anomalies confirmées, une de chaque type — 40€ et 30€ à retirer.
      await provClient.query(
        `INSERT INTO anomalies (dossier_id, periode, type_anomalie, gravite, reference_piece, description, statut, details)
         VALUES ($1, $2, 'entretien_vehicule_tourisme_deduit_a_tort', 'signale', '5001', 'test', 'resolu', $3::jsonb)`,
        [DOSSIER_ID, PERIODE_DEBUT, JSON.stringify({ montantDeduit: 40 })]
      );
      await provClient.query(
        `INSERT INTO anomalies (dossier_id, periode, type_anomalie, gravite, reference_piece, description, statut, details)
         VALUES ($1, $2, 'location_vehicule_tourisme_deduite_a_tort', 'bloquant', '5002', 'test', 'resolu', $3::jsonb)`,
        [DOSSIER_ID, PERIODE_DEBUT, JSON.stringify({ montantDeduit: 30 })]
      );

      await provClient.query('COMMIT');
    } catch (err) {
      await provClient.query('ROLLBACK');
      throw err;
    } finally {
      provClient.release();
      await provisioningPool.end();
    }

    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });
    const resultat = await verifierFraisVehiculeLegere(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: PERIODE_DEBUT,
      periodeFin: PERIODE_FIN,
      utilisateurId: UTILISATEUR_ID,
    });

    expect(resultat.corrections).toBe(2);

    const ajustement = await avecContexteCabinet(pool, CABINET_ID, (c) =>
      c.query<{ montant_ajuste: string }>(
        `SELECT montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = 'deductible_abs'`,
        [CALCUL_ID]
      )
    );
    expect(Number.parseFloat(ajustement.rows[0]!.montant_ajuste)).toBe(730); // 800 - 40 - 30

    const anomalies = await avecContexteCabinet(pool, CABINET_ID, (c) =>
      c.query<{ statut: string }>(`SELECT statut FROM anomalies WHERE dossier_id = $1 ORDER BY reference_piece`, [DOSSIER_ID])
    );
    expect(anomalies.rows.every((r) => r.statut === 'obsolete')).toBe(true);
  });
});
