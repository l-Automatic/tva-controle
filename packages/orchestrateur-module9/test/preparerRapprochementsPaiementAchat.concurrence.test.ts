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
const ID_COMPTE_TVA = 1;

function ligne(id: number, compteId: number, numeroCompte: string, debit: string, credit: string, ledgerEntryId: number) {
  return {
    id,
    debit,
    credit,
    label: `Ecriture ${id}`,
    date: '2025-04-05',
    created_at: '2025-04-05',
    updated_at: '2025-04-05',
    journal: { id: 1, url: 'x' },
    ledger_account: { id: compteId, number: numeroCompte, url: 'x' },
    ledger_entry: { id: ledgerEntryId },
    lettered_ledger_entry_lines: { ids: [], url: 'x' },
  };
}

// Toutes les lignes possibles, indexées par le compte réellement demandé —
// le fake fetch ne renvoie QUE celles dont ledger_account.id correspond
// au filtre reçu, comme le ferait vraiment Pennylane. Sans ce filtrage
// réel, les deux appels différents de cette fonction (l'un ancré sur le
// compte TVA, l'autre par compte tiers pour chaque candidat) reçoivent le
// même mélange et se corrompent mutuellement.
function toutesLesLignes() {
  const lignes: ReturnType<typeof ligne>[] = [];
  for (let i = 1; i <= NB_FOURNISSEURS; i++) {
    const compteChargeId = 100 + i;
    const compteTiersId = 200 + i;
    const ledgerEntryId = i * 10;
    lignes.push(
      ligne(ledgerEntryId, ID_COMPTE_TVA, '44566', '10', '0', ledgerEntryId),
      ligne(ledgerEntryId + 1, compteChargeId, '604000', '50', '0', ledgerEntryId),
      ligne(ledgerEntryId + 2, compteTiersId, `401FRS${i}`, '0', '60', ledgerEntryId)
    );
    // Paiement partiel candidat pour ce fournisseur, sur son propre compte
    // tiers, jamais lettré, jamais déjà réclamé.
    lignes.push(ligne(ledgerEntryId + 3, compteTiersId, `401FRS${i}`, '30', '0', ledgerEntryId + 3));
  }
  return lignes;
}

function fakeFetch(): typeof fetch {
  const toutes = toutesLesLignes();
  return (async (rawUrl: string) => {
    const url = new URL(rawUrl);

    if (url.pathname.includes('trial_balance')) {
      return new Response(
        JSON.stringify({
          items: [{ number: '44566', formatted_number: '44566', label: 'TVA déductible', debits: '50', credits: '0' }],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 }
      );
    }

    if (url.pathname.includes('ledger_entry_lines')) {
      const filtreBrut = url.searchParams.get('filter');
      let comptesIds: number[] = [];
      if (filtreBrut) {
        try {
          const filtre = JSON.parse(filtreBrut) as { field: string; value: unknown }[];
          const champCompte = filtre.find((f) => f.field === 'ledger_account_id');
          if (champCompte && Array.isArray(champCompte.value)) {
            comptesIds = champCompte.value as number[];
          }
        } catch {
          // filtre non parseable : aucun compte, réponse vide ci-dessous
        }
      }
      const items = toutes.filter((l) => comptesIds.includes(l.ledger_account.id));
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
