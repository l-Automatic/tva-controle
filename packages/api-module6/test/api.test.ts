import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { hasherMotDePasse } from '@tva-controle/orchestrateur-module9';

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
let jetonCollab = '';
let jetonAdmin = '';
let utilisateurAdminId = '';
let emailCollab = '';
let emailAdmin = '';

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

    emailCollab = `collab-${Date.now()}@test.fr`;
    emailAdmin = `admin-${Date.now()}@test.fr`;
    const hashCollab = await hasherMotDePasse('mot-de-passe-test-collab');
    const hashAdmin = await hasherMotDePasse('mot-de-passe-test-admin');

    const resUser = await client.query<{ id: string }>(
      `INSERT INTO utilisateurs (cabinet_id, nom, email, role, mot_de_passe_hash) VALUES ($1, 'Collaborateur Test', $2, 'collaborateur', $3) RETURNING id`,
      [cabinetId, emailCollab, hashCollab]
    );
    utilisateurId = resUser.rows[0]!.id;

    const resAdmin = await client.query<{ id: string }>(
      `INSERT INTO utilisateurs (cabinet_id, nom, email, role, mot_de_passe_hash) VALUES ($1, 'Admin Cabinet Test', $2, 'admin_cabinet', $3) RETURNING id`,
      [cabinetId, emailAdmin, hashAdmin]
    );
    utilisateurAdminId = resAdmin.rows[0]!.id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await provisioningPool.end();
  }

  // Connexion réelle via la vraie route /auth/login (pas un jeton fabriqué
  // à la main) — pour les deux comptes, un jeton par rôle.
  const resLoginCollab = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: emailCollab, motDePasse: 'mot-de-passe-test-collab' },
  });
  jetonCollab = JSON.parse(resLoginCollab.body).jeton;

  const resLoginAdmin = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: emailAdmin, motDePasse: 'mot-de-passe-test-admin' },
  });
  jetonAdmin = JSON.parse(resLoginAdmin.body).jeton;
}, 20_000);

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('API Module 6 — authentification (10/08)', () => {
  it('refuse une requête sans jeton', async () => {
    const res = await app.inject({ method: 'GET', url: `/dossiers/${dossierId}/anomalies` });
    expect(res.statusCode).toBe(401);
  });

  it('refuse un jeton invalide', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies`,
      headers: { authorization: 'Bearer pas-un-vrai-jeton' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepte un jeton valide obtenu via une vraie connexion', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('/health ne nécessite pas de jeton', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('/auth/login refuse un mauvais mot de passe, même message que pour un email inconnu', async () => {
    const resMauvaisMdp = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: emailCollab, motDePasse: 'mauvais-mot-de-passe' },
    });
    expect(resMauvaisMdp.statusCode).toBe(401);

    const resEmailInconnu = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'inconnu@test.fr', motDePasse: 'peu-importe' },
    });
    expect(resEmailInconnu.statusCode).toBe(401);
    expect(JSON.parse(resMauvaisMdp.body).erreur).toBe(JSON.parse(resEmailInconnu.body).erreur);
  });

  it('les paramètres cabinet sont réservés au rôle admin_cabinet', async () => {
    const resCollab = await app.inject({
      method: 'GET',
      url: '/parametres-cabinet',
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resCollab.statusCode).toBe(403);

    const resAdmin = await app.inject({
      method: 'GET',
      url: '/parametres-cabinet',
      headers: { authorization: `Bearer ${jetonAdmin}` },
    });
    expect(resAdmin.statusCode).toBe(200);
  });

  it('un admin_cabinet peut définir le mot de passe d’un collaborateur de son cabinet', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/utilisateurs/${utilisateurId}/mot-de-passe`,
      headers: { authorization: `Bearer ${jetonAdmin}` },
      payload: { motDePasse: 'nouveau-mot-de-passe-1234' },
    });
    expect(res.statusCode).toBe(204);

    const resLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: emailCollab, motDePasse: 'nouveau-mot-de-passe-1234' },
    });
    expect(resLogin.statusCode).toBe(200);
  });

  it('un collaborateur ne peut pas définir de mot de passe (réservé à admin_cabinet)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/utilisateurs/${utilisateurAdminId}/mot-de-passe`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { motDePasse: 'peu-importe-1234' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un admin_cabinet liste les utilisateurs de son cabinet, un collaborateur ne peut pas', async () => {
    const resAdmin = await app.inject({
      method: 'GET',
      url: '/utilisateurs',
      headers: { authorization: `Bearer ${jetonAdmin}` },
    });
    expect(resAdmin.statusCode).toBe(200);
    const liste = JSON.parse(resAdmin.body);
    expect(liste.some((u: { id: string }) => u.id === utilisateurId)).toBe(true);
    // Jamais le hash, quel que soit le champ demandé
    expect(liste[0]).not.toHaveProperty('motDePasseHash');
    expect(liste[0]).not.toHaveProperty('mot_de_passe_hash');

    const resCollab = await app.inject({
      method: 'GET',
      url: '/utilisateurs',
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resCollab.statusCode).toBe(403);
  });

  it('un admin_cabinet crée un nouveau collaborateur, qui peut ensuite se connecter', async () => {
    const emailNouveau = `nouveau-${Date.now()}@test.fr`;
    const resCreation = await app.inject({
      method: 'POST',
      url: '/utilisateurs',
      headers: { authorization: `Bearer ${jetonAdmin}` },
      payload: { nom: 'Nouveau Collab', email: emailNouveau, role: 'collaborateur', motDePasse: 'mot-de-passe-1234' },
    });
    expect(resCreation.statusCode).toBe(201);

    const resLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: emailNouveau, motDePasse: 'mot-de-passe-1234' },
    });
    expect(resLogin.statusCode).toBe(200);
  });

  it('refuse de créer un utilisateur avec un email déjà utilisé', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/utilisateurs',
      headers: { authorization: `Bearer ${jetonAdmin}` },
      payload: { nom: 'Doublon', email: emailCollab, role: 'collaborateur', motDePasse: 'mot-de-passe-1234' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('un collaborateur ne peut pas créer de nouvel utilisateur', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/utilisateurs',
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { nom: 'X', email: `x-${Date.now()}@test.fr`, role: 'collaborateur', motDePasse: 'mot-de-passe-1234' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un admin_cabinet désactive un collaborateur, qui ne peut plus se connecter ensuite', async () => {
    const emailACreer = `a-desactiver-${Date.now()}@test.fr`;
    const resCreation = await app.inject({
      method: 'POST',
      url: '/utilisateurs',
      headers: { authorization: `Bearer ${jetonAdmin}` },
      payload: { nom: 'À Désactiver', email: emailACreer, role: 'collaborateur', motDePasse: 'mot-de-passe-1234' },
    });
    const { id: idACreer } = JSON.parse(resCreation.body);

    const resDesactivation = await app.inject({
      method: 'POST',
      url: `/utilisateurs/${idACreer}/desactiver`,
      headers: { authorization: `Bearer ${jetonAdmin}` },
    });
    expect(resDesactivation.statusCode).toBe(204);

    const resLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: emailACreer, motDePasse: 'mot-de-passe-1234' },
    });
    expect(resLogin.statusCode).toBe(401);
  });

  it('un collaborateur ne peut pas désactiver un utilisateur (réservé à admin_cabinet)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/utilisateurs/${utilisateurAdminId}/desactiver`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // Le refus de désactiver le dernier admin_cabinet est déjà couvert, de
  // façon isolée, côté writeRepository.test.ts — pas retesté ici : ce
  // fichier partage UN SEUL cabinet entre tous ses tests, désactiver le
  // seul admin_cabinet existant (celui de jetonAdmin) casserait tous les
  // autres tests de rôle de ce fichier.
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
      headers: { authorization: `Bearer ${jetonCollab}` },
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
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, commentaire: 'Corrigé en compta' },
    });
    expect(resResoudre.statusCode).toBe(204);

    const resListeOuvertes = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=ouvert`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resListeOuvertes.json()).toEqual([]);

    const resListeResolues = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=resolu`,
      headers: { authorization: `Bearer ${jetonCollab}` },
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
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, decision: 'vente' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse une décision "hors_vente" sans motif', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-2');
    const res = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, decision: 'hors_vente' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('qualifie "vente" avec un taux, visible ensuite comme résolue avec le taux en resolution', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-3');
    const res = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, decision: 'vente', taux: 20 },
    });
    expect(res.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=resolu`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    const ligne = resListe.json().find((a: { id: string }) => a.id === anomalieId);
    expect(ligne).toMatchObject({ statut: 'resolu', resolution: { taux: 20 } });
  });

  it('qualifie "hors_vente" avec un motif, visible ensuite comme justifiée', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-4');
    const res = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, decision: 'hors_vente', motif: 'Remboursement assurance' },
    });
    expect(res.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=justifie`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    const ligne = resListe.json().find((a: { id: string }) => a.id === anomalieId);
    expect(ligne?.statut).toBe('justifie');
  });

  it('renvoie 409 si l’anomalie a déjà été qualifiée par quelqu’un d’autre entre-temps', async () => {
    const anomalieId = await creerAnomalieEncaissement('471-5');
    const premiere = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, decision: 'vente', taux: 10 },
    });
    expect(premiere.statusCode).toBe(204);

    const seconde = await app.inject({
      method: 'POST',
      url: `/anomalies/${anomalieId}/qualifier`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, decision: 'hors_vente', motif: 'tentative concurrente' },
    });
    expect(seconde.statusCode).toBe(409);

    // La première qualification doit rester intacte, pas écrasée par la
    // tentative rejetée.
    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/anomalies?statut=resolu`,
      headers: { authorization: `Bearer ${jetonCollab}` },
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
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId },
    });
    expect(resConfirmer.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=confirmed`,
      headers: { authorization: `Bearer ${jetonCollab}` },
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
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId },
    });

    const resListeConfirmees = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=confirmed`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    const confirmees = resListeConfirmees.json();
    expect(confirmees).toHaveLength(1); // une seule confirmed à la fois
    expect(confirmees[0].id).toBe(nouvelleId);

    const resAncienne = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=rejected`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resAncienne.json().some((c: { id: string }) => c.id === conventionId)).toBe(true);
  });
});

describe('API Module 6 — ajout manuel d’une convention', () => {
  it('refuse sans cle ni valeur', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/conventions`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('crée une convention candidate via l’API, visible ensuite dans la liste', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/conventions`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, cle: 'comptes_equipement', valeur: ['6063'] },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(typeof id).toBe('string');

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=candidate`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    const creee = resListe.json().find((c: { id: string }) => c.id === id);
    expect(creee).toMatchObject({ cle: 'comptes_equipement', valeur: ['6063'], source: 'saisie_manuelle' });
  });

  it('la nouvelle convention peut ensuite être confirmée comme n’importe quelle candidate', async () => {
    const resCreation = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/conventions`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId, cle: 'comptes_charge_service', valeur: ['611'] },
    });
    const { id } = resCreation.json();

    const resConfirmer = await app.inject({
      method: 'POST',
      url: `/conventions/${id}/confirmer`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId },
    });
    expect(resConfirmer.statusCode).toBe(204);

    const resListe = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/conventions?statut=confirmed`,
      headers: { authorization: `Bearer ${jetonCollab}` },
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
      headers: { authorization: `Bearer ${jetonCollab}` },
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
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    const evenementsUtilisateur = resUtilisateur.json();
    expect(evenementsUtilisateur.length).toBeGreaterThan(0);
    expect(evenementsUtilisateur.every((e: { acteur: string }) => e.acteur === 'utilisateur')).toBe(true);

    const resSysteme = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/audit?acteur=systeme`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resSysteme.json()).toEqual([]); // aucun cycle pipeline lancé dans ce test file
  });

  it('exporte au format CSV, avec les en-têtes attendus et le bon Content-Type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/audit/export?typeEvenement=convention_confirmee`,
      headers: { authorization: `Bearer ${jetonCollab}` },
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
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('API Module 6 — taux historique tiers (chantier B) via HTTP', () => {
  it('liste, confirme puis retrouve une proposition de taux tiers via l’API', async () => {
    const client = await pool.connect();
    let propositionId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      const res = await client.query<{ id: string }>(
        `INSERT INTO taux_historique_tiers (dossier_id, numero_compte_tiers, taux_habituel, nb_occurrences, statut, source)
         VALUES ($1, '411http', 10, 4, 'candidate', 'decouverte_continue') RETURNING id`,
        [dossierId]
      );
      propositionId = res.rows[0]!.id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const resListeCandidates = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/taux-historique-tiers?statut=candidate`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resListeCandidates.statusCode).toBe(200);
    expect(resListeCandidates.json().some((t: { id: string }) => t.id === propositionId)).toBe(true);

    const resConfirmer = await app.inject({
      method: 'POST',
      url: `/taux-historique-tiers/${propositionId}/confirmer`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId },
    });
    expect(resConfirmer.statusCode).toBe(204);

    const resListeConfirmees = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/taux-historique-tiers?statut=confirmed`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resListeConfirmees.json().some((t: { id: string }) => t.id === propositionId)).toBe(true);
  });

  it('rejette une proposition de taux tiers via l’API', async () => {
    const client = await pool.connect();
    let propositionId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      const res = await client.query<{ id: string }>(
        `INSERT INTO taux_historique_tiers (dossier_id, numero_compte_tiers, taux_habituel, nb_occurrences, statut, source)
         VALUES ($1, '411http-reject', 20, 2, 'candidate', 'decouverte_continue') RETURNING id`,
        [dossierId]
      );
      propositionId = res.rows[0]!.id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const resRejeter = await app.inject({
      method: 'POST',
      url: `/taux-historique-tiers/${propositionId}/rejeter`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: { utilisateurId },
    });
    expect(resRejeter.statusCode).toBe(204);

    const resListeRejetees = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/taux-historique-tiers?statut=rejected`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(resListeRejetees.json().some((t: { id: string }) => t.id === propositionId)).toBe(true);
  });
});

describe('API Module 6 — GET /dossiers/:id/tiers', () => {
  it('liste les tiers de référence d’un dossier avec leur niveau de confiance', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
      await client.query(
        `INSERT INTO tiers_reference (dossier_id, numero_compte_tiers, nom_tiers, niveau_confiance, nb_controles_sans_anomalie, derniere_date_controle)
         VALUES ($1, '411tiers-http', 'Client HTTP Test', 'a_surveiller', 4, '2025-06-01')`,
        [dossierId]
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const res = await app.inject({
      method: 'GET',
      url: `/dossiers/${dossierId}/tiers`,
      headers: { authorization: `Bearer ${jetonCollab}` },
    });
    expect(res.statusCode).toBe(200);
    const tiers = res.json().find((t: { numeroCompteTiers: string }) => t.numeroCompteTiers === '411tiers-http');
    expect(tiers).toMatchObject({
      nomTiers: 'Client HTTP Test',
      niveauConfiance: 'a_surveiller',
      nbControlesSansAnomalie: 4,
    });
  });
});

describe('API Module 6 — POST /dossiers/:id/cycles — validation seulement', () => {
  // Le succès réel de cette route dépend d'un vrai appel réseau à Pennylane,
  // impossible à tester depuis ce bac à sable (réseau restreint). Seule la
  // validation des champs requis est testée ici — le chemin de succès doit
  // être vérifié en conditions réelles (VPS avec accès réseau + vrai token).
  it('refuse sans periodeDebut/periodeFin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/cycles`,
      headers: { authorization: `Bearer ${jetonCollab}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse sans jeton d’authentification, comme toutes les autres routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dossiers/${dossierId}/cycles`,
      payload: { periodeDebut: '2025-01-01', periodeFin: '2025-01-31', pennylaneToken: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});
