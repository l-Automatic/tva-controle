import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Anomalie } from '@tva-controle/core';
import type { ResultatCalculTva } from '@tva-controle/calcul-module7';
import {
  enregistrerAnomalies,
  enregistrerPropositionsConventions,
  enregistrerPropositionsTaux,
  enregistrerCalcul,
  validerCalcul,
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
      { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 2, compte: '445711', description: 'b' },
    ];

    await avecClient((client) => enregistrerAnomalies(client, dossierId, '2025-02-01', anomalies));

    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode: '2025-02-01' }));
    expect(liste).toHaveLength(2);
    expect(liste.every((a) => a.statut === 'ouvert')).toBe(true);
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
  });
});
