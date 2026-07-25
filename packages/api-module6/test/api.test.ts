import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
const app = buildApp(pool);

let cabinetId = '';
let dossierId = '';
let utilisateurId = '';

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const resCabinet = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet Test api-module6 ${Date.now()}`,
    ]);
    cabinetId = resCabinet.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);

    const resDossier = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier Test API', 'reel_normal', 'pennylane', 'sandbox-api', true)
       RETURNING id`,
      [cabinetId]
    );
    dossierId = resDossier.rows[0]!.id;

    const resUser = await client.query<{ id: string }>(
      `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Collaborateur Test', $2, 'collaborateur') RETURNING id`,
      [cabinetId, `collab-${Date.now()}@test.fr`]
    );
    utilisateurId = resUser.rows[0]!.id;

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
  await app.close();
  await pool.end();
});

describe('API Module 6 — garde-fou header cabinet', () => {
  it('refuse une requête sans header x-cabinet-id', async () => {
    const res = await app.inject({ method: 'GET', url: `/dossiers/${dossierId}/anomalies` });
    expect(res.statusCode).toBe(400);
  });

  it('/health ne nécessite pas de header cabinet', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('API Module 6 — cycle de vie d’une anomalie', () => {
  let anomalieId = '';

  it('insère une anomalie directement en base puis la liste via l’API', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      const res = await client.query<{ id: string }>(
        `INSERT INTO anomalies (dossier_id, periode, type_anomalie, gravite, reference_piece, description, statut)
         VALUES ($1, '2025-01-01', 'taux_incoherent', 'bloquant', '999', 'test', 'ouvert') RETURNING id`,
        [dossierId]
      );
      anomalieId = res.rows[0]!.id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ typeAnomalie: 'taux_incoherent', statut: 'ouvert' });
  });

  it('résout l’anomalie via l’API, et le filtre par statut la retrouve ensuite', async () => {
    const resResoudre = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/resoudre`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, commentaire: 'Corrigé en compta' },
    });
    expect(resResoudre.statusCode).toBe(204);

    const resListeOuvertes = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=ouvert`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(resListeOuvertes.json()).toEqual([]);

    const resListeResolues = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=resolu`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(resListeResolues.json()).toHaveLength(1);
  });
});

describe('API Module 6 — cycle de vie d’une convention candidate', () => {
  let conventionId = '';

  it('crée une convention candidate puis la confirme via l’API', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      const res = await client.query<{ id: string }>(
        `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source)
         VALUES ($1, 'compte_tva_due_autoliquidee', '"4454"', 'candidate', 'onboarding') RETURNING id`,
        [dossierId]
      );
      conventionId = res.rows[0]!.id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const resConfirmer = await app.inject({
      method: 'POST',
      url: `/conventions/${conventionId}/confirmer`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId },
    });
    expect(resConfirmer.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=confirmed`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(resListe.json()).toHaveLength(1);
  });

  it('confirmer une nouvelle candidate sur la même clé neutralise l’ancienne confirmed', async () => {
    const client = await pool.connect();
    let nouvelleId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      const res = await client.query<{ id: string }>(
        `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source)
         VALUES ($1, 'compte_tva_due_autoliquidee', '"4455"', 'candidate', 'decouverte_continue') RETURNING id`,
        [dossierId]
      );
      nouvelleId = res.rows[0]!.id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    await app.inject({
      method: 'POST',
      url: `/conventions/${nouvelleId}/confirmer`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId },
    });

    const resListeConfirmees = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=confirmed`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    const confirmees = resListeConfirmees.json();
    expect(confirmees).toHaveLength(1); // une seule confirmed à la fois
    expect(confirmees[0].id).toBe(nouvelleId);

    const resAncienne = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=rejected`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(resAncienne.json().some((c: { id: string }) => c.id === conventionId)).toBe(true);
  });
});
