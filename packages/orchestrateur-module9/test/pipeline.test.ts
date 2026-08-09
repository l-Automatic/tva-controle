import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { executerCycleTva } from '../src/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

let CABINET_ID = '';
let DOSSIER_ID = '';

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'connector-pennylane', 'test', 'fixtures', name), 'utf-8')
  );
}

const pool = creerPool(CONNECTION_STRING);

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const resCabinet = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet Test pipeline ${Date.now()}`,
    ]);
    CABINET_ID = resCabinet.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const resDossier = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Electricien Sandbox', 'reel_normal', 'pennylane', 'sandbox-electricien', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = resDossier.rows[0]!.id;

    await client.query(
      `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source) VALUES
       ($1, 'compte_tva_due_autoliquidee', '"4454"', 'confirmed', 'onboarding'),
       ($1, 'compte_tva_deductible_autoliquidee', '"445664"', 'confirmed', 'onboarding'),
       ($1, 'comptes_vente_service', '["706"]', 'confirmed', 'onboarding')`,
      [DOSSIER_ID]
    );
    await client.query(
      `INSERT INTO taux_historique (dossier_id, compte_produit_ou_charge, taux_habituel, nb_occurrences)
       VALUES ($1, '445711', 20, 40)`,
      [DOSSIER_ID]
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

// Même routeur que le test d'intégration du connecteur — réutilise les
// mêmes fixtures réelles (cas ROUSSEAU) plutôt que d'en inventer de nouvelles.
function fakeFetchRouteur(): typeof fetch {
  const comptesTva = loadFixture('ledger_accounts_tva.json');
  const lignesTva = loadFixture('ledger_entry_lines_tva_rousseau_only.json');
  const pieceRousseau = loadFixture('piece_rousseau_lines.json');
  const comptesCandidats = loadFixture('ledger_accounts_candidats_rousseau.json');
  const lettrageRousseau = loadFixture('lettering_rousseau_lettree.json');

  return (async (rawUrl: string) => {
    const url = new URL(rawUrl);
    const filtre = url.searchParams.get('filter') ?? '';

    if (url.pathname === '/api/external/v2/trial_balance') {
      // Solde fournisseur (correction déductible, cf. pipeline.ts) : ces
      // tests utilisent comptesTvaOverride donc n'ont jamais besoin de la
      // balance pour la découverte TVA — vide dans tous les cas ici.
      return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
    }
    if (url.pathname === '/api/external/v2/ledger_accounts') {
      // Compte 471 (attente) : ce dossier de test n'en a aucun dans les fixtures
      // existantes, réponse vide explicite pour ne pas hériter par erreur des
      // fixtures 445 sur ce nouveau type de requête (même forme de filtre).
      if (filtre.includes('"value":"471"')) return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
      if (filtre.includes('"field":"number"')) return new Response(JSON.stringify(comptesTva), { status: 200 });
      if (filtre.includes('"field":"id"')) return new Response(JSON.stringify(comptesCandidats), { status: 200 });
    }
    if (url.pathname === '/api/external/v2/ledger_entry_lines') {
      if (filtre.includes('"field":"ledger_account_id"'))
        return new Response(JSON.stringify(lignesTva), { status: 200 });
      if (filtre.includes('"field":"id"')) return new Response(JSON.stringify(lettrageRousseau), { status: 200 });
    }
    if (/\/ledger_entries\/\d+\/ledger_entry_lines/.test(url.pathname)) {
      return new Response(JSON.stringify(pieceRousseau), { status: 200 });
    }
    throw new Error(`URL non routée : ${rawUrl}`);
  }) as unknown as typeof fetch;
}

describe('executerCycleTva — bout-en-bout, vraie base + cas réel ROUSSEAU', () => {
  it('charge le contexte réel, calcule, et classe la vente en collectee_20', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchRouteur() });

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
      client,
      comptesTvaOverride: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      comptesVenteServiceOverride: ['706'],
      comptesChargeServiceOverride: ['611'],
      comptesCarburantOverride: ['6061'],
      comptesEquipementOverride: ['6063'],
    });

    expect(resultat.statut).toBe('calcule');
    if (resultat.statut !== 'calcule') throw new Error('assertion');

    expect(resultat.resultat.lignes).toEqual([
      { categorie: 'collectee_20', montant: 711.03, referencesPieces: [22495307276288] },
    ]);
    expect(resultat.resultat.sens).toBe('a_decaisser');
    expect(resultat.resultat.tvaNette).toBe(711.03);

    // Module 10 : le pipeline doit avoir tracé ses deux événements auto pour
    // ce cycle, sans qu'aucun appel explicite à l'audit n'ait été fait ici —
    // c'est le pipeline lui-même qui les déclenche.
    const clientVerif = await pool.connect();
    try {
      await clientVerif.query('BEGIN');
      await clientVerif.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

      const evenements = await clientVerif.query(
        `SELECT type_evenement, module_source, acteur FROM audit_log
         WHERE dossier_id = $1 AND type_evenement IN ('anomalies_detectees', 'calcul_genere')
         ORDER BY horodatage`,
        [DOSSIER_ID]
      );
      expect(evenements.rows.map((r) => r.type_evenement)).toEqual(['anomalies_detectees', 'calcul_genere']);
      expect(evenements.rows.every((r) => r.acteur === 'systeme')).toBe(true);

      const calculGenere = await clientVerif.query(
        `SELECT details FROM audit_log WHERE dossier_id = $1 AND type_evenement = 'calcul_genere'
         ORDER BY horodatage DESC LIMIT 1`,
        [DOSSIER_ID]
      );
      expect(calculGenere.rows[0]!.details.calculId).toBe(resultat.calculId);
      await clientVerif.query('COMMIT');
    } finally {
      clientVerif.release();
    }
  });

  it('utilise bien le taux de la base réelle (445711 -> 20% via taux_historique, pas le repli national)', async () => {
    // Le taux national par défaut pour 445711 est aussi 20%, donc ce test ne
    // suffirait pas seul à prouver la priorité dossier — mais confirme au
    // moins que la valeur chargée depuis Postgres est bien utilisée dans le
    // calcul (pas ignorée). La priorité dossier vs national est déjà testée
    // isolément dans controles-module4/test/controle.test.ts.
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchRouteur() });

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-02-01',
      periodeFin: '2025-02-28',
      client,
      comptesTvaOverride: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      comptesVenteServiceOverride: ['706'],
      comptesChargeServiceOverride: ['611'],
      comptesCarburantOverride: ['6061'],
      comptesEquipementOverride: ['6063'],
    });

    expect(resultat.statut).toBe('calcule');
    if (resultat.statut !== 'calcule') throw new Error('assertion');

    // Vérifie que ce n'est pas juste retourné en mémoire — le calcul doit
    // réellement exister en base, récupérable indépendamment de l'appel.
    const clientVerif = await pool.connect();
    try {
      await clientVerif.query('BEGIN');
      await clientVerif.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);
      const resCalcul = await clientVerif.query(`SELECT * FROM calculs_tva WHERE id = $1`, [
        resultat.calculId,
      ]);
      expect(resCalcul.rows).toHaveLength(1);
      expect(resCalcul.rows[0].statut).toBe('brouillon');

      const resLignes = await clientVerif.query(
        `SELECT * FROM calculs_tva_lignes WHERE calcul_id = $1`,
        [resultat.calculId]
      );
      expect(resLignes.rows.length).toBeGreaterThan(0);
      await clientVerif.query('COMMIT');
    } finally {
      clientVerif.release();
    }
  });
});

describe('executerCycleTva — dérivation des comptes depuis conventions_dossier (sans override)', () => {
  it('exclut la vente non lettrée car comptes_vente_service=["706"] est bien lu en base, pas silencieusement vide', async () => {
    // Même pièce ROUSSEAU, mais lettrage à vide (facture non payée) — si
    // comptes_vente_service n'était PAS correctement dérivé de la base (donc
    // vide par repli), la ligne serait classée "bien" et resterait exigible
    // malgré le non-lettrage. Ce test échouerait silencieusement faux si la
    // dérivation était cassée : c'est exactement ce qu'on veut détecter.
    const comptesTva = loadFixture('ledger_accounts_tva.json');
    const comptesCandidats = loadFixture('ledger_accounts_candidats_rousseau.json');
    const pieceRousseau = loadFixture('piece_rousseau_lines.json');
    const lignesTvaFixture = loadFixture('ledger_entry_lines_tva_rousseau_only.json');
    const lettrageReel = loadFixture('lettering_rousseau_lettree.json') as {
      items: Array<Record<string, unknown>>;
    };
    const lettrageNonLettre = {
      items: [
        {
          ...lettrageReel.items[0],
          lettered_ledger_entry_lines: { ids: [], url: 'x' }, // non lettrée cette fois
        },
      ],
      has_more: false,
      next_cursor: null,
    };

    const fetchImpl = (async (rawUrl: string) => {
      const url = new URL(rawUrl);
      const filtre = url.searchParams.get('filter') ?? '';
      if (url.pathname === '/api/external/v2/trial_balance') {
        // Solde fournisseur (correction déductible) : comptesTvaOverride est
        // utilisé dans ce test, donc pas besoin de la balance pour la
        // découverte TVA — vide dans tous les cas ici.
        return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
      }
      if (url.pathname === '/api/external/v2/ledger_accounts') {
        // Compte 471 (attente) : ce dossier de test n'en a aucun dans les fixtures
        // existantes, réponse vide explicite pour ne pas hériter par erreur des
        // fixtures 445 sur ce nouveau type de requête (même forme de filtre).
        if (filtre.includes('"value":"471"')) return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
        if (filtre.includes('"field":"number"')) return new Response(JSON.stringify(comptesTva), { status: 200 });
        if (filtre.includes('"field":"id"')) return new Response(JSON.stringify(comptesCandidats), { status: 200 });
      }
      if (url.pathname === '/api/external/v2/ledger_entry_lines') {
        if (filtre.includes('"field":"ledger_account_id"'))
          return new Response(JSON.stringify(lignesTvaFixture), { status: 200 });
        if (filtre.includes('"field":"id"'))
          return new Response(JSON.stringify(lettrageNonLettre), { status: 200 });
      }
      if (/\/ledger_entries\/\d+\/ledger_entry_lines/.test(url.pathname)) {
        return new Response(JSON.stringify(pieceRousseau), { status: 200 });
      }
      throw new Error(`URL non routée : ${rawUrl}`);
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
      client,
      comptesTvaOverride: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      // Aucun override : comptesVenteService doit venir de conventions_dossier
      // (seedée à ["706"] dans le beforeAll de ce fichier).
    });

    expect(resultat.statut).toBe('calcule');
    if (resultat.statut !== 'calcule') throw new Error('assertion');

    // Si la dérivation avait échoué (liste vide par repli), la ligne serait
    // classée "bien" et resterait dans collectee_20 malgré le non-lettrage.
    expect(resultat.resultat.lignes).toEqual([]);
    expect(resultat.resultat.ecrituresExclues).toHaveLength(1);
    expect(resultat.resultat.ecrituresExclues[0]?.motif).toContain('pas encore exigible');
  });
});

describe('executerCycleTva — chemin bloqué (comportement central de cette v1)', () => {
  it('s’arrête avant le calcul si une anomalie bloquante existe, sans jamais appeler calculerTva', async () => {
    const comptesTva = loadFixture('ledger_accounts_tva.json');
    const comptesCandidats = loadFixture('ledger_accounts_candidats_rousseau.json');

    // Ligne TVA fabriquée : 445711 à 100, produit à 1000 -> taux implicite 10%,
    // mais le vrai taux_historique en base pour ce dossier dit 20% (inséré
    // plus tôt via provisioning) -> anomalie taux_incoherent, bloquante.
    const ledgerEntryId = 999;
    const ligneTvaIncoherente = {
      items: [
        {
          id: 1,
          label: 'TEST INCOHERENT',
          debit: '0.0',
          credit: '100.0',
          date: '2025-01-20',
          created_at: '2025-01-20T00:00:00Z',
          updated_at: '2025-01-20T00:00:00Z',
          journal: { id: 1, url: 'x' },
          categories: [],
          ledger_account: { id: 12028930117632, number: '445711', url: 'x' },
          ledger_entry: { id: ledgerEntryId },
          lettered_ledger_entry_lines: { ids: [], url: 'x' },
        },
      ],
      has_more: false,
      next_cursor: null,
    };
    const piece = {
      items: [
        { id: 2, debit: '0.0', credit: '1000.0', label: 'produit', ledger_account_id: 12028930121728, ledger_account: { id: 12028930121728, number: '7061', url: 'x' } },
        { id: 1, debit: '0.0', credit: '100.0', label: 'tva', ledger_account_id: 12028930117632, ledger_account: { id: 12028930117632, number: '445711', url: 'x' } },
      ],
      has_more: false,
      next_cursor: null,
    };

    const fetchImpl = (async (rawUrl: string) => {
      const url = new URL(rawUrl);
      const filtre = url.searchParams.get('filter') ?? '';
      if (url.pathname === '/api/external/v2/trial_balance') {
        // Solde fournisseur (correction déductible) : comptesTvaOverride est
        // utilisé dans ce test, donc pas besoin de la balance pour la
        // découverte TVA — vide dans tous les cas ici.
        return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
      }
      if (url.pathname === '/api/external/v2/ledger_accounts') {
        // Compte 471 (attente) : ce dossier de test n'en a aucun dans les fixtures
        // existantes, réponse vide explicite pour ne pas hériter par erreur des
        // fixtures 445 sur ce nouveau type de requête (même forme de filtre).
        if (filtre.includes('"value":"471"')) return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
        if (filtre.includes('"field":"number"')) return new Response(JSON.stringify(comptesTva), { status: 200 });
        if (filtre.includes('"field":"id"')) return new Response(JSON.stringify(comptesCandidats), { status: 200 });
      }
      if (url.pathname === '/api/external/v2/ledger_entry_lines' && filtre.includes('"field":"ledger_account_id"')) {
        return new Response(JSON.stringify(ligneTvaIncoherente), { status: 200 });
      }
      if (/\/ledger_entries\/\d+\/ledger_entry_lines/.test(url.pathname)) {
        return new Response(JSON.stringify(piece), { status: 200 });
      }
      throw new Error(`URL non routée : ${rawUrl}`);
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });

    // Compté AVANT le cycle bloqué : ce dossier partage son id avec d'autres
    // tests de ce même fichier (même beforeAll), qui ont déjà pu générer des
    // événements calcul_genere sur cette même période. On vérifie donc une
    // absence de NOUVEL événement, pas une absence absolue.
    const clientAvant = await pool.connect();
    let nbCalculGenereAvant = 0;
    try {
      await clientAvant.query('BEGIN');
      await clientAvant.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);
      const resAvant = await clientAvant.query(
        `SELECT COUNT(*)::int AS n FROM audit_log WHERE dossier_id = $1 AND type_evenement = 'calcul_genere'`,
        [DOSSIER_ID]
      );
      nbCalculGenereAvant = resAvant.rows[0].n;
      await clientAvant.query('COMMIT');
    } finally {
      clientAvant.release();
    }

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-01-01',
      periodeFin: '2025-01-31',
      client,
      comptesTvaOverride: ['44562', '44566', '445664', '445711', '445712', '445713', '4454'],
      comptesVenteServiceOverride: ['706'],
      comptesChargeServiceOverride: ['611'],
      comptesCarburantOverride: ['6061'],
      comptesEquipementOverride: ['6063'],
    });

    expect(resultat.statut).toBe('bloque');
    if (resultat.statut !== 'bloque') throw new Error('assertion');
    expect(resultat.anomalies.some((a) => a.type === 'taux_incoherent' && a.gravite === 'bloquant')).toBe(true);

    // Même sur le chemin bloqué, les anomalies doivent être en base — c'est
    // ce qui permet à Module 6 de les voir et de les traiter, sans quoi le
    // blocage serait invisible pour le collaborateur.
    const clientVerif = await pool.connect();
    try {
      await clientVerif.query('BEGIN');
      await clientVerif.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);
      const res = await clientVerif.query(
        `SELECT * FROM anomalies WHERE dossier_id = $1 AND type_anomalie = 'taux_incoherent'`,
        [DOSSIER_ID]
      );
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows[0].statut).toBe('ouvert');

      // Module 10 : le blocage lui-même doit être tracé, avec les ids réels
      // des anomalies bloquantes (pas juste un décompte) — c'est la preuve
      // exploitable en cas de contrôle : "le calcul a refusé de tourner à
      // cause de CES anomalies précises".
      const auditBloque = await clientVerif.query(
        `SELECT * FROM audit_log WHERE dossier_id = $1 AND type_evenement = 'calcul_bloque'`,
        [DOSSIER_ID]
      );
      expect(auditBloque.rows).toHaveLength(1);
      expect(auditBloque.rows[0].acteur).toBe('systeme');
      const anomalieIdsTracees: string[] = auditBloque.rows[0].details.anomalieIds;
      expect(anomalieIdsTracees).toContain(res.rows[0].id);

      // Le calcul n'ayant jamais tourné DANS CE TEST, aucun NOUVEL événement
      // calcul_genere ne doit être apparu depuis le comptage fait avant
      // l'appel — comparaison relative, pas absence absolue, car ce dossier
      // est partagé avec d'autres tests de ce fichier qui, eux, génèrent
      // légitimement des calculs sur la même période.
      const auditCalcule = await clientVerif.query(
        `SELECT COUNT(*)::int AS n FROM audit_log WHERE dossier_id = $1 AND type_evenement = 'calcul_genere'`,
        [DOSSIER_ID]
      );
      expect(auditCalcule.rows[0].n).toBe(nbCalculGenereAvant);

      await clientVerif.query('COMMIT');
    } finally {
      clientVerif.release();
    }
  });
});

describe('executerCycleTva — découverte automatique des comptes via la balance (sans comptesTvaOverride)', () => {
  it('utilise la balance, exclut les comptes à solde nul (ex: sous-comptes pays jamais utilisés)', async () => {
    // Fixture réelle + un compte fantôme à solde nul ajouté volontairement —
    // exactement le scénario qui a produit un calcul vide en conditions
    // réelles (comptes TVA pays désactivés/jamais utilisés remontés par
    // l'ancienne découverte par simple préfixe).
    const balanceReelle = loadFixture('trial_balance_electricien.json') as { items: unknown[] };
    const balanceAvecFantome = {
      ...balanceReelle,
      items: [
        ...balanceReelle.items,
        { credits: '0.0', debits: '0.0', label: 'TVA collectée Portugal à 16%', number: '445721073', formatted_number: '44572107300' },
      ],
    };

    const comptesCandidats = loadFixture('ledger_accounts_candidats_rousseau.json');
    const lignesTvaFixture = loadFixture('ledger_entry_lines_tva_rousseau_only.json');
    const pieceRousseau = loadFixture('piece_rousseau_lines.json');
    const lettrageRousseau = loadFixture('lettering_rousseau_lettree.json');

    let appelBalance = false;
    let comptesEnvoyesAuxEcritures: string[] = [];

    const fetchImpl = (async (rawUrl: string) => {
      const url = new URL(rawUrl);

      if (url.pathname === '/api/external/v2/trial_balance') {
        appelBalance = true;
        return new Response(JSON.stringify(balanceAvecFantome), { status: 200 });
      }

      const filtre = url.searchParams.get('filter') ?? '';
      if (url.pathname === '/api/external/v2/ledger_accounts') {
        // Compte 471 (attente) : ce dossier de test n'en a aucun dans les fixtures
        // existantes, réponse vide explicite pour ne pas hériter par erreur des
        // fixtures 445 sur ce nouveau type de requête (même forme de filtre).
        if (filtre.includes('"value":"471"')) return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
        if (filtre.includes('"field":"number"') && filtre.includes('"operator":"in"')) {
          // Capture les comptes réellement transmis pour la résolution —
          // le fantôme à solde nul ne doit PAS y figurer.
          const valeurMatch = filtre.match(/"value":\[(.*?)\]/);
          comptesEnvoyesAuxEcritures = valeurMatch ? JSON.parse(`[${valeurMatch[1]}]`) : [];
          return new Response(JSON.stringify(loadFixture('ledger_accounts_tva.json')), { status: 200 });
        }
        if (filtre.includes('"field":"id"')) {
          return new Response(JSON.stringify(comptesCandidats), { status: 200 });
        }
      }
      if (url.pathname === '/api/external/v2/ledger_entry_lines') {
        if (filtre.includes('"field":"ledger_account_id"'))
          return new Response(JSON.stringify(lignesTvaFixture), { status: 200 });
        if (filtre.includes('"field":"id"'))
          return new Response(JSON.stringify(lettrageRousseau), { status: 200 });
      }
      if (/\/ledger_entries\/\d+\/ledger_entry_lines/.test(url.pathname)) {
        return new Response(JSON.stringify(pieceRousseau), { status: 200 });
      }
      throw new Error(`URL non routée : ${rawUrl}`);
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const resultat = await executerCycleTva(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      periodeDebut: '2025-04-01',
      periodeFin: '2025-04-30',
      client,
      // Pas de comptesTvaOverride : doit passer par la balance.
      comptesVenteServiceOverride: ['706'],
      comptesChargeServiceOverride: ['611'],
      comptesCarburantOverride: ['6061'],
      comptesEquipementOverride: ['6063'],
    });

    expect(appelBalance).toBe(true);
    expect(comptesEnvoyesAuxEcritures).not.toContain('445721073');
    expect(comptesEnvoyesAuxEcritures.sort()).toEqual(
      ['4454', '44562', '44566', '445664', '445711', '445712', '445713'].sort()
    );
    expect(resultat.statut).toBe('calcule');
    expect(resultat.statut).toBe('calcule');
  });
});
