import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { creerPool, avecContexteCabinet } from '../src/db/pool.js';
import { chargerContexteDossier, chargerDossier, listerDossiers } from '../src/db/dossierRepository.js';

// Ce test crée ses propres données via le vrai mécanisme de provisioning
// (provisioning_create_cabinet, déjà validé dans 002_roles_and_privileges.sql)
// plutôt que de dépendre d'un état de base préparé à la main — reproductible
// sur n'importe quelle base fraîche ayant reçu les migrations 001 et 002.
const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

const pool = creerPool(CONNECTION_STRING);
let cabinetId = '';
let dossierId = '';

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const resCabinet = await client.query<{ id: string }>(
      `SELECT provisioning_create_cabinet($1) AS id`,
      [`Cabinet Test dossierRepository ${Date.now()}`]
    );
    cabinetId = resCabinet.rows[0]!.id;

    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);

    const resDossier = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Electricien Sandbox', 'reel_normal', 'pennylane', 'sandbox-electricien', true)
       RETURNING id`,
      [cabinetId]
    );
    dossierId = resDossier.rows[0]!.id;
    await client.query(
      `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source) VALUES
       ($1, 'compte_tva_due_autoliquidee', '"4454"', 'confirmed', 'onboarding'),
       ($1, 'compte_tva_deductible_autoliquidee', '"445664"', 'confirmed', 'onboarding')`,
      [dossierId]
    );
    await client.query(
      `INSERT INTO taux_historique (dossier_id, compte_produit_ou_charge, taux_habituel, nb_occurrences)
       VALUES ($1, '445711', 20, 40)`,
      [dossierId]
    );
    await client.query(
      `INSERT INTO immobilisations (dossier_id, compte, designation, montant_ht, type_bien, statut, source)
       VALUES ($1, '218100', 'Camionnette Renault Trafic', 18000, 'vehicule_utilitaire', 'confirmed', 'onboarding')`,
      [dossierId]
    );
    await client.query(
      `INSERT INTO tiers_reference (dossier_id, numero_compte_tiers, nom_tiers, niveau_confiance, nb_controles_sans_anomalie)
       VALUES ($1, '401CONNU', 'Fournisseur Connu SARL', 'confiance', 8)`,
      [dossierId]
    );
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
  await pool.end();
});

describe('chargerContexteDossier — contre la vraie base', () => {
  it('charge le taux historique réel (445711 -> 20%)', async () => {
    const contexte = await avecContexteCabinet(pool, cabinetId, (client) =>
      chargerContexteDossier(client, dossierId)
    );

    expect(contexte.tauxHistorique).toEqual([
      { compteOuTiers: '445711', tauxHabituel: 20, nbOccurrences: 40 },
    ]);
  });

  it('charge les conventions confirmées (comptes autoliquidation)', async () => {
    const contexte = await avecContexteCabinet(pool, cabinetId, (client) =>
      chargerContexteDossier(client, dossierId)
    );

    const cles = contexte.conventions.map((c) => c.cle).sort();
    expect(cles).toEqual(['compte_tva_deductible_autoliquidee', 'compte_tva_due_autoliquidee']);
    expect(contexte.conventions.find((c) => c.cle === 'compte_tva_due_autoliquidee')?.valeur).toBe('4454');
  });

  it('charge le parc de véhicules (camionnette utilitaire confirmée)', async () => {
    const contexte = await avecContexteCabinet(pool, cabinetId, (client) =>
      chargerContexteDossier(client, dossierId)
    );

    expect(contexte.parcVehicules).toEqual([{ type: 'vehicule_utilitaire' }]);
  });

  it('charge les tiers déjà connus (tiers_reference)', async () => {
    const contexte = await avecContexteCabinet(pool, cabinetId, (client) =>
      chargerContexteDossier(client, dossierId)
    );

    expect(contexte.tiersConnus).toEqual(['401CONNU']);
  });

  it('charge les infos du dossier lui-même', async () => {
    const dossier = await avecContexteCabinet(pool, cabinetId, (client) =>
      chargerDossier(client, dossierId)
    );

    expect(dossier).toMatchObject({
      regimeTva: 'reel_normal',
      tvaEncaissement: true,
      logicielSource: 'pennylane',
      externalCompanyId: 'sandbox-electricien',
    });
  });

  it('la RLS bloque bien un cabinet différent (isolation vérifiée)', async () => {
    const contexte = await avecContexteCabinet(
      pool,
      '00000000-0000-0000-0000-000000000000', // cabinet inexistant / autre
      (client) => chargerContexteDossier(client, dossierId)
    );
    // Aucune ligne visible : la RLS filtre le dossier d'un autre cabinet
    expect(contexte.tauxHistorique).toEqual([]);
    expect(contexte.conventions).toEqual([]);
    expect(contexte.parcVehicules).toEqual([]);
    expect(contexte.tiersConnus).toEqual([]);
  });
});

describe('listerDossiers', () => {
  it('trouve le dossier réel par une recherche partielle sur le nom', async () => {
    const resultats = await avecContexteCabinet(pool, cabinetId, (client) =>
      listerDossiers(client, cabinetId, 'Electricien')
    );
    expect(resultats.some((d) => d.id === dossierId && d.nom === 'Electricien Sandbox')).toBe(true);
  });

  it('ne retourne rien pour une recherche qui ne correspond à aucun dossier', async () => {
    const resultats = await avecContexteCabinet(pool, cabinetId, (client) =>
      listerDossiers(client, cabinetId, 'CompteQuiNexistePas12345')
    );
    expect(resultats).toEqual([]);
  });

  it('sans recherche, retourne tous les dossiers du cabinet', async () => {
    const resultats = await avecContexteCabinet(pool, cabinetId, (client) => listerDossiers(client, cabinetId));
    expect(resultats.some((d) => d.id === dossierId)).toBe(true);
  });
});

describe('chargerContexteDossier — taux "mixte" (NULL) filtré, 10/08', () => {
  it('un client confirmé avec taux_habituel NULL (mixte) n’apparaît jamais dans tauxHistorique[]', async () => {
    const compteTiersMixte = `411MIXTE${Date.now()}`;
    await avecContexteCabinet(pool, cabinetId, (client) =>
      client.query(
        `INSERT INTO taux_historique_tiers (dossier_id, numero_compte_tiers, taux_habituel, nb_occurrences, statut, source)
         VALUES ($1, $2, NULL, 0, 'confirmed', 'saisie_manuelle')`,
        [dossierId, compteTiersMixte]
      )
    );

    const contexte = await avecContexteCabinet(pool, cabinetId, (client) =>
      chargerContexteDossier(client, dossierId)
    );

    expect(contexte.tauxHistorique.some((t) => t.compteOuTiers === compteTiersMixte)).toBe(false);
  });

  it('un client confirmé avec un vrai taux continue d’apparaître normalement', async () => {
    const compteTiersNormal = `411NORMAL${Date.now()}`;
    await avecContexteCabinet(pool, cabinetId, (client) =>
      client.query(
        `INSERT INTO taux_historique_tiers (dossier_id, numero_compte_tiers, taux_habituel, nb_occurrences, statut, source)
         VALUES ($1, $2, 20, 0, 'confirmed', 'saisie_manuelle')`,
        [dossierId, compteTiersNormal]
      )
    );

    const contexte = await avecContexteCabinet(pool, cabinetId, (client) =>
      chargerContexteDossier(client, dossierId)
    );

    const trouve = contexte.tauxHistorique.find((t) => t.compteOuTiers === compteTiersNormal);
    expect(trouve?.tauxHabituel).toBe(20);
  });
});
