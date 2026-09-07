import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import { creerPool, avecContexteCabinet } from '../src/db/pool.js';
import { verifierComptesACategoriser } from '../src/verifierComptesACategoriser.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

let CABINET_ID = '';
let DOSSIER_ID = '';

const pool = creerPool(CONNECTION_STRING);

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const cabinetRes = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet test verif categorisation ${Date.now()}`,
    ]);
    CABINET_ID = cabinetRes.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [CABINET_ID]);

    const dossierRes = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier test verif categorisation', 'reel_normal', 'pennylane', 'sandbox-verif-categ', true)
       RETURNING id`,
      [CABINET_ID]
    );
    DOSSIER_ID = dossierRes.rows[0]!.id;

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

describe('verifierComptesACategoriser', () => {
  it('retourne les deux listes vides quand la balance ne montre aucun compte TVA avec mouvement (rien à catégoriser)', async () => {
    const client = new PennylaneClient({ token: 'x', fetchImpl: fakeFetchBalanceVide() });

    const resultat = await verifierComptesACategoriser(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
    });

    // 10/08 : format étendu à deux champs, couvre aussi la
    // sous-catégorisation autoliquidation (comptesChargeAutoliquidation),
    // jusqu'ici seulement une suggestion enfouie dans le cycle complet.
    expect(resultat).toEqual({ comptesACategoriser: [], comptesServiceSansSousCategorieAutoliquidation: [] });
  });

  it('bug réel corrigé (10/08, signalé par Claude Code) : un compte confirmé comptesEntretienVehicule/LocationVehicule/VenteExport est bien exclu de comptesACategoriser', async () => {
    await avecContexteCabinet(pool, CABINET_ID, (client) =>
      client.query(
        `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source)
         VALUES ($1, 'comptes_entretien_vehicule', '["615500"]'::jsonb, 'confirmed', 'onboarding')`,
        [DOSSIER_ID]
      )
    );

    const fetchImpl = (async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname.includes('trial_balance') || url.pathname.includes('general_balance')) {
        return new Response(
          JSON.stringify({
            items: [{ number: '44566', formatted_number: '44566', label: 'TVA déductible', debits: '100', credits: '0' }],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 }
        );
      }
      if (url.pathname.includes('ledger_entry_lines')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 1,
                debit: '100',
                credit: '0',
                label: 'Entretien véhicule',
                date: '2025-03-15',
                created_at: '2025-03-15',
                updated_at: '2025-03-15',
                journal: { id: 1, url: 'x' },
                ledger_account: { id: 1, number: '44566', url: 'x' },
                ledger_entry: { id: 1 },
                lettered_ledger_entry_lines: { ids: [], url: 'x' },
              },
              {
                id: 2,
                debit: '0',
                credit: '100',
                label: 'Entretien véhicule',
                date: '2025-03-15',
                created_at: '2025-03-15',
                updated_at: '2025-03-15',
                journal: { id: 1, url: 'x' },
                ledger_account: { id: 2, number: '615500', url: 'x' },
                ledger_entry: { id: 1 },
                lettered_ledger_entry_lines: { ids: [], url: 'x' },
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ items: [], has_more: false, next_cursor: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new PennylaneClient({ token: 'x', fetchImpl });

    const resultat = await verifierComptesACategoriser(pool, {
      cabinetId: CABINET_ID,
      dossierId: DOSSIER_ID,
      client,
      periodeDebut: '2025-03-01',
      periodeFin: '2025-03-31',
    });

    // Le compte 615500 (confirmé comptesEntretienVehicule) ne doit JAMAIS
    // apparaître dans comptesACategoriser — c'était le bug.
    expect(resultat.comptesACategoriser.some((c) => c.compte === '615500')).toBe(false);
  });
});
