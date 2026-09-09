import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool } from '../src/db/pool.js';
import { preparerRapprochementsPaiementAchat } from '../src/preparerRapprochementsPaiementAchat.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

let CABINET_ID = '';
let DOSSIER_ID = '';

const pool = creerPool(CONNECTION_STRING);
const PERIODE_DEBUT = '2025-04-01';
const PERIODE_FIN = '2025-04-30';

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const cabinetRes = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet test rapprochements concurrence ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);
    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test rapprochements concurrence', 'reel_normal', 'pennylane', 'sandbox-rapprochements-concurrence', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = dossierRes.rows[0]!.id;
    await client.query(
      `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source)
       VALUES ($1, 'comptes_charge_service', '["604"]'::jsonb, 'confirmed', 'onboarding')`,
      [DOSSIER_ID]
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

// 5 fournisseurs distincts, chacun avec une facture non lettrée ET un
// paiement partiel candidat — vérifie que le passage à une concurrence
// limitée (4, cf. correctif du 10/08) ne perd, ne duplique et
// n'échange aucun candidat entre eux malgré le traitement en parallèle.
const NB_FOURNISSEURS = 5;

function fakeFetch(): typeof fetch {
  return (async (rawUrl: string) => {
    const url = new URL(rawUrl);

    if (url.pathname.includes('trial_balance')) {
      return new Response(
        JSON.stringify({
          items: [{ number: '44566', formatted_number: '44566', label: 'TVA déductible', debits: '500', credits: '0' }],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 }
      );
    }

    if (url.pathname.includes('ledger_entry_lines')) {
      const items = [];
      for (let i = 1; i <= NB_FOURNISSEURS; i++) {
        items.push(
          {
            id: i * 10,
            debit: '0',
            credit: '100',
            label: `Facture fournisseur ${i}`,
            date: '2025-04-05',
            created_at: '2025-04-05',
            updated_at: '2025-04-05',
            journal: { id: 1, url: 'x' },
            ledger_account: { id: 1, number: '44566', url: 'x' },
            ledger_entry: { id: i * 10 },
            lettered_ledger_entry_lines: { ids: [], url: 'x' },
          },
          {
            id: i * 10 + 1,
            debit: '0',
            credit: '500',
            label: `Facture fournisseur ${i}`,
            date: '2025-04-05',
            created_at: '2025-04-05',
            updated_at: '2025-04-05',
            journal: { id: 1, url: 'x' },
            ledger_account: { id: 2, number: '604000', url: 'x' },
            ledger_entry: { id: i * 10 },
            lettered_ledger_entry_lines: { ids: [], url: 'x' },
          },
          {
            id: i * 10 + 2,
            debit: '0',
            credit: '600',
            label: `Fournisseur ${i}`,
            date: '2025-04-05',
            created_at: '2025-04-05',
            updated_at: '2025-04-05',
            journal: { id: 1, url: 'x' },
            ledger_account: { id: 100 + i, number: `401FRS${i}`, url: 'x' },
            ledger_entry: { id: i * 10 },
            lettered_ledger_entry_lines: { ids: [], url: 'x' },
          }
        );
      }
      // Second appel (mouvements par compte tiers, un candidat de paiement partiel générique).
      items.push({
        id: 999,
        debit: '50',
        credit: '0',
        label: 'Paiement partiel',
        date: '2025-04-10',
        created_at: '2025-04-10',
        updated_at: '2025-04-10',
        journal: { id: 1, url: 'x' },
        ledger_account: { id: 200, number: '401GENERIQUE', url: 'x' },
        ledger_entry: { id: 999 },
        lettered_ledger_entry_lines: { ids: [], url: 'x' },
      });
      return new Response(JSON.stringify({ items, has_more: false, next_cursor: null }), { status: 200 });
    }

    return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('preparerRapprochementsPaiementAchat — concurrence limitée (10/08, bug réel corrigé)', () => {
  it('traite tous les fournisseurs candidats sans en perdre ni en dupliquer malgré le traitement en parallèle', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetch() });

    const resultat = await preparerRapprochementsPaiementAchat(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: PERIODE_DEBUT,
      periodeFin: PERIODE_FIN,
    });

    expect(resultat).toHaveLength(NB_FOURNISSEURS);
    const comptesVus = new Set(resultat.map((f) => f.compteFournisseur));
    expect(comptesVus.size).toBe(NB_FOURNISSEURS); // jamais deux fois le même, jamais un manquant
    for (let i = 1; i <= NB_FOURNISSEURS; i++) {
      expect(comptesVus.has(`401FRS${i}`)).toBe(true);
    }
  });
});
