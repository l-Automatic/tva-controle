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

describe('API Module 6 — qualification d’un encaissement non affecté (compte 471)', () => {
  async function creerAnomalieEncaissement(referencePiece: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      const res = await client.query<{ id: string }>(
        `INSERT INTO anomalies (dossier_id, periode, type_anomalie, gravite, reference_piece, description, details, statut)
         VALUES ($1, '2025-09-01', 'encaissement_non_affecte', 'bloquant', $2, 'test',
                 '{"montantTTC": 250, "libelle": "VIR RECU", "date": "2025-09-10"}', 'ouvert')
         RETURNING id`,
        [dossierId, referencePiece]
      );
      await client.query('COMMIT');
      return res.rows[0]!.id;
    } finally {
      client.release();
    }
  }

  it('refuse une décision "vente" sans taux', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-1');
    const res = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, decision: 'vente' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse une décision "hors_vente" sans motif', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-2');
    const res = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, decision: 'hors_vente' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('qualifie "vente" avec un taux, visible ensuite comme résolue avec le taux en resolution', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-3');
    const res = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, decision: 'vente', taux: 20 },
    });
    expect(res.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=resolu`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    const ligne = resListe.json().find((a: { id: string }) => a.id === anomalieId);
    expect(ligne).toMatchObject({ statut: 'resolu', resolution: { taux: 20 } });
  });

  it('qualifie "hors_vente" avec un motif, visible ensuite comme justifiée', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-4');
    const res = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, decision: 'hors_vente', motif: 'Remboursement assurance' },
    });
    expect(res.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=justifie`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    const ligne = resListe.json().find((a: { id: string }) => a.id === anomalieId);
    expect(ligne?.statut).toBe('justifie');
  });

  it('renvoie 409 si l’anomalie a déjà été qualifiée par quelqu’un d’autre entre-temps', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-5');
    const premiere = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, decision: 'vente', taux: 10 },
    });
    expect(premiere.statusCode).toBe(204);

    const seconde = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, decision: 'hors_vente', motif: 'tentative concurrente' },
    });
    expect(seconde.statusCode).toBe(409);

    // La première qualification doit rester intacte, pas écrasée par la
    // tentative rejetée.
    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=resolu`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    const ligne = resListe.json().find((a: { id: string }) => a.id === anomalieId);
    expect(ligne).toMatchObject({ statut: 'resolu', resolution: { taux: 10 } });
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

describe('API Module 6 — ajout manuel d’une convention', () => {
  it('refuse sans cle ni valeur', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/conventions`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('crée une convention candidate via l’API, visible ensuite dans la liste', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/conventions`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, cle: 'comptes_equipement', valeur: ['6063'] },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(typeof id).toBe('string');

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=candidate`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    const creee = resListe.json().find((c: { id: string }) => c.id === id);
    expect(creee).toMatchObject({ cle: 'comptes_equipement', valeur: ['6063'], source: 'saisie_manuelle' });
  });

  it('la nouvelle convention peut ensuite être confirmée comme n’importe quelle candidate', async () => {
    const resCreation = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/conventions`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId, cle: 'comptes_charge_service', valeur: ['611'] },
    });
    const { id } = resCreation.json();

    const resConfirmer = await app.inject({
      method: 'POST',
      url: `/conventions/${id}/confirmer`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: { utilisateurId },
    });
    expect(resConfirmer.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=confirmed`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(resListe.json().some((c: { id: string }) => c.id === id)).toBe(true);
  });
});

describe('API Module 6 — consultation et export de l’audit (Module 10)', () => {
  // Ce fichier partage un seul dossierId entre tous les describe — les
  // actions des tests précédents (résolution d'anomalie, confirmations de
  // conventions) ont déjà généré des événements d'audit pour ce dossier.
  // On filtre donc systématiquement par type_evenement pour ne vérifier que
  // ce que CE test a produit, plutôt que de compter un total absolu fragile.

  it('l’anomalie résolue plus haut est bien consultable via /audit, avec le nom de l’acteur résolu par jointure', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/audit?typeEvenement=anomalie_resolue`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(res.statusCode).toBe(200);
    const evenements = res.json();
    expect(evenements.length).toBeGreaterThanOrEqual(1);
    expect(evenements[0]).toMatchObject({
      typeEvenement: 'anomalie_resolue',
      acteur: 'utilisateur',
      acteurUtilisateurId: utilisateurId,
      acteurNom: 'Collaborateur Test',
    });
  });

  it('le filtre acteur=utilisateur exclut les événements systeme, et inversement', async () => {
    const resUtilisateur = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/audit?acteur=utilisateur`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    const evenementsUtilisateur = resUtilisateur.json();
    expect(evenementsUtilisateur.length).toBeGreaterThan(0);
    expect(evenementsUtilisateur.every((e: { acteur: string }) => e.acteur === 'utilisateur')).toBe(true);

    const resSysteme = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/audit?acteur=systeme`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(resSysteme.json()).toEqual([]); // aucun cycle pipeline lancé dans ce test file
  });

  it('exporte au format CSV, avec les en-têtes attendus et le bon Content-Type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/audit/export?typeEvenement=convention_confirmee`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`audit-${dossierId}.csv`);

    const lignes = res.body.trim().split('\n');
    expect(lignes[0]).toBe('horodatage,type_evenement,module_source,acteur,acteur_nom,acteur_utilisateur_id,details');
    expect(lignes.length).toBeGreaterThanOrEqual(2); // en-tête + au moins une ligne
    expect(lignes.some((l) => l.includes('convention_confirmee'))).toBe(true);
  });

  it('refuse un typeEvenement inconnu en renvoyant une liste vide plutôt qu’une erreur — filtre exact, pas de correspondance partielle', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/audit?typeEvenement=type_qui_nexiste_pas`,
      headers: { 'x-cabinet-id': cabinetId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('API Module 6 — POST /dossiers/:id/cycles — validation seulement', () => {
  // Le succès réel de cette route dépend d'un vrai appel réseau à Pennylane,
  // impossible à tester depuis ce bac à sable (réseau restreint). Seule la
  // validation des champs requis est testée ici — le chemin de succès doit
  // être vérifié en conditions réelles (VPS avec accès réseau + vrai token).
  it('refuse sans periodeDebut/periodeFin/pennylaneToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/cycles`,
      headers: { 'x-cabinet-id': cabinetId },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse sans header x-cabinet-id, comme toutes les autres routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/cycles`,
      payload: { periodeDebut: '2025-01-01', periodeFin: '2025-01-31', pennylaneToken: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });
});
