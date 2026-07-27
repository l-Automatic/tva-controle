import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Anomalie } from '@tva-controle/core';
import type { ResultatCalculTva } from '@tva-controle/calcul-module7';
import {
  enregistrerAnomalies,
  enregistrerEvenementAudit,
  enregistrerPropositionsConventions,
  enregistrerPropositionsTaux,
  enregistrerCalcul,
  validerCalcul,
  resoudreAnomalie,
  CalculDejaValideError,
} from '../src/db/writeRepository.js';
import { listerAnomalies, listerConventions, listerTauxHistorique, listerCalculs } from '../src/db/readRepository.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
let cabinetId = '';
let dossierId = '';

async function avecClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
    const resultat = await fn(client);
    await client.query('COMMIT');
    return resultat;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const resCabinet = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet Test writeRepository ${Date.now()}`,
    ]);
    cabinetId = resCabinet.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
    const resDossier = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier Test Write', 'reel_normal', 'pennylane', 'sandbox-write', true) RETURNING id`,
      [cabinetId]
    );
    dossierId = resDossier.rows[0]!.id;
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

describe('enregistrerAnomalies', () => {
  it('insère plusieurs anomalies en une fois, toutes en statut ouvert', async () => {
    const anomalies: Anomalie[] = [
      { type: 'taux_incoherent', gravite: 'bloquant', ledgerEntryId: 1, compte: '445711', description: 'a' },
      {
        type: 'paiement_partiel_a_verifier',
        gravite: 'signale',
        ledgerEntryId: 2,
        compte: '411000',
        description: 'b',
        details: { groupeIds: [10, 11, 12] },
      },
    ];

    const inserees = await avecClient((client) =>
      enregistrerAnomalies(client, dossierId, '2025-02-01', anomalies)
    );

    // Le pipeline (Module 9) a besoin de ces ids réels pour tracer les
    // anomalies bloquantes dans l'audit — la fonction ne doit plus renvoyer
    // void silencieusement.
    expect(inserees).toHaveLength(2);
    expect(inserees.every((a) => typeof a.id === 'string' && a.id.length > 0)).toBe(true);
    expect(inserees.map((a) => a.gravite).sort()).toEqual(['bloquant', 'signale']);

    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode: '2025-02-01' }));
    expect(liste).toHaveLength(2);
    expect(liste.every((a) => a.statut === 'ouvert')).toBe(true);

    // Bug corrigé : `compte` était calculé par le Module 4 pour chaque
    // anomalie mais jamais persisté (colonne absente + non repris dans
    // l'INSERT) — invisible pour le collaborateur qui traite l'anomalie.
    const tauxIncoherent = liste.find((a) => a.typeAnomalie === 'taux_incoherent');
    expect(tauxIncoherent?.compte).toBe('445711');

    // Idem pour `details` : stocké et renvoyé, mais jusqu'ici jamais affiché
    // côté frontend — on vérifie ici la couche donnée, pas l'affichage.
    const paiementPartiel = liste.find((a) => a.typeAnomalie === 'paiement_partiel_a_verifier');
    expect(paiementPartiel?.compte).toBe('411000');
    expect(paiementPartiel?.details).toEqual({ groupeIds: [10, 11, 12] });
  });

  it('relancer un cycle sur la même période remplace les anomalies ouvertes sans les accumuler, mais préserve celles déjà traitées', async () => {
    const periode = '2025-05-01';
    const premierLot: Anomalie[] = [
      { type: 'taux_incoherent', gravite: 'bloquant', ledgerEntryId: 100, compte: '445711', description: 'x' },
      { type: 'nouveau_tiers_a_verifier', gravite: 'signale', ledgerEntryId: 101, compte: '411000', description: 'y' },
    ];
    const premiereInsertion = await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, premierLot));

    // Un collaborateur traite une des deux anomalies avant la relance.
    const aTraitee = premiereInsertion.find((a) => a.type === 'nouveau_tiers_a_verifier')!;
    await avecClient((client) =>
      client.query(`UPDATE anomalies SET statut = 'resolu' WHERE id = $1`, [aTraitee.id])
    );

    // Relance du cycle sur la même période : cette fois une seule anomalie détectée.
    const secondLot: Anomalie[] = [
      { type: 'taux_incoherent', gravite: 'bloquant', ledgerEntryId: 100, compte: '445711', description: 'x2' },
    ];
    await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, secondLot));

    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode }));

    // Pas d'accumulation : l'ancienne anomalie 'ouvert' a été remplacée, pas
    // dupliquée à côté de la nouvelle.
    expect(liste.filter((a) => a.statut === 'ouvert')).toHaveLength(1);
    // L'anomalie déjà traitée par un humain reste en base, intacte.
    expect(liste.find((a) => a.id === aTraitee.id)?.statut).toBe('resolu');
  });
});

describe('enregistrerPropositionsConventions et enregistrerPropositionsTaux', () => {
  it('insère les propositions du Module 3 en statut candidate', async () => {
    await avecClient((client) =>
      enregistrerPropositionsConventions(client, dossierId, [
        {
          cle: 'compte_tva_due_autoliquidee',
          valeur: '4454',
          confidenceNote: 'Détecté sur 6 pièces',
          nbOccurrences: 6,
        },
      ])
    );
    await avecClient((client) =>
      enregistrerPropositionsTaux(client, dossierId, [
        { compteOuTiers: '445712', tauxHabituel: 10, nbOccurrences: 5 },
      ])
    );

    const conventions = await avecClient((client) => listerConventions(client, dossierId, 'candidate'));
    const taux = await avecClient((client) => listerTauxHistorique(client, dossierId, 'candidate'));

    expect(conventions.some((c) => c.cle === 'compte_tva_due_autoliquidee')).toBe(true);
    expect(taux.some((t) => t.compteProduitOuCharge === '445712' && t.tauxHabituel === 10)).toBe(true);
  });
});

describe('enregistrerCalcul et validerCalcul', () => {
  it('enregistre un calcul brouillon puis le valide, et l’immuabilité bloque ensuite toute modification', async () => {
    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 711.03, referencesPieces: [22495307276288] }],
      tvaNette: 711.03,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };

    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-03-01', '2025-03-31', resultat)
    );

    let calculs = await avecClient((client) => listerCalculs(client, dossierId));
    let calcul = calculs.find((c) => c.id === calculId);
    expect(calcul).toMatchObject({ statut: 'brouillon', tvaNette: 711.03, sens: 'a_decaisser' });

    // Récupérer un utilisateur pour la validation
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u-${Date.now()}@test.fr`]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;

    await avecClient((client) => validerCalcul(client, calculId, utilisateurId));

    calculs = await avecClient((client) => listerCalculs(client, dossierId));
    calcul = calculs.find((c) => c.id === calculId);
    expect(calcul?.statut).toBe('valide');

    // Le trigger d'immuabilité (002) doit maintenant bloquer toute tentative
    // de modification du montant — même avec les fonctions de ce module.
    await expect(
      avecClient((client) =>
        client.query(`UPDATE calculs_tva SET tva_nette = 999 WHERE id = $1`, [calculId])
      )
    ).rejects.toThrow();

    // Le Module 10 doit avoir tracé la validation, avec le bon acteur et le
    // bon utilisateur — pas juste que le statut a changé en base.
    const audit = await avecClient((client) =>
      client.query(
        `SELECT * FROM audit_log WHERE type_evenement = 'calcul_valide' AND details->>'calculId' = $1`,
        [calculId]
      )
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].acteur).toBe('utilisateur');
    expect(audit.rows[0].acteur_utilisateur_id).toBe(utilisateurId);
    expect(audit.rows[0].dossier_id).toBe(dossierId);
  });

  it('relancer un cycle sur un calcul encore en brouillon le remplace au lieu de violer la contrainte unique', async () => {
    const premier: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 100, referencesPieces: [1] }],
      tvaNette: 100,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const premierCalculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-06-01', '2025-06-30', premier)
    );

    const second: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 250, referencesPieces: [2] }],
      tvaNette: 250,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const secondCalculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-06-01', '2025-06-30', second)
    );

    // Même ligne mise à jour en place (pas de DELETE possible sur
    // calculs_tva) : même id, mais valeurs de la relance.
    expect(secondCalculId).toBe(premierCalculId);

    const calculs = await avecClient((client) => listerCalculs(client, dossierId));
    const surCettePeriode = calculs.filter((c) => c.id === premierCalculId);
    expect(surCettePeriode).toHaveLength(1);
    expect(surCettePeriode[0]).toMatchObject({ tvaNette: 250 });
  });

  it('refuse de relancer un cycle sur une période déjà validée plutôt que de laisser remonter une erreur de contrainte brute', async () => {
    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 50, referencesPieces: [3] }],
      tvaNette: 50,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-07-01', '2025-07-31', resultat)
    );
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u2-${Date.now()}@test.fr`]
      )
    );
    await avecClient((client) => validerCalcul(client, calculId, resUser.rows[0]!.id));

    await expect(
      avecClient((client) => enregistrerCalcul(client, dossierId, '2025-07-01', '2025-07-31', resultat))
    ).rejects.toThrow(CalculDejaValideError);
  });
});

describe('enregistrerEvenementAudit (Module 10)', () => {
  it('insère une ligne dans audit_log rattachée au cabinet du contexte transactionnel courant', async () => {
    await avecClient((client) =>
      enregistrerEvenementAudit(client, {
        dossierId,
        typeEvenement: 'evenement_test',
        moduleSource: 'test_suite',
        acteur: 'systeme',
        details: { exemple: 'valeur' },
      })
    );

    const res = await avecClient((client) =>
      client.query(`SELECT * FROM audit_log WHERE type_evenement = 'evenement_test'`)
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].cabinet_id).toBe(cabinetId);
    expect(res.rows[0].dossier_id).toBe(dossierId);
    expect(res.rows[0].acteur).toBe('systeme');
    expect(res.rows[0].acteur_utilisateur_id).toBeNull();
    expect(res.rows[0].details).toEqual({ exemple: 'valeur' });
  });

  it('resoudreAnomalie trace un événement anomalie_resolue avec l’utilisateur qui a résolu', async () => {
    const inserees = await avecClient((client) =>
      enregistrerAnomalies(client, dossierId, '2025-04-01', [
        { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 42, compte: '445711', description: 'test' },
      ])
    );
    const anomalieId = inserees[0]!.id;

    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u2-${Date.now()}@test.fr`]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;

    await avecClient((client) => resoudreAnomalie(client, anomalieId, utilisateurId, 'traitée'));

    const audit = await avecClient((client) =>
      client.query(
        `SELECT * FROM audit_log WHERE type_evenement = 'anomalie_resolue' AND details->>'anomalieId' = $1`,
        [anomalieId]
      )
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].acteur).toBe('utilisateur');
    expect(audit.rows[0].acteur_utilisateur_id).toBe(utilisateurId);
  });
});
