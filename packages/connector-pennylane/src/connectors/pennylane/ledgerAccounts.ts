import { PennylaneClient } from './client.js';
import type { PennylaneLedgerAccountItem, PennylaneLedgerAccountsResponse } from './types.js';

const LEDGER_ACCOUNTS_PATH = '/api/external/v2/ledger_accounts';

export interface CompteResolu {
  id: number;
  numero: string;
  libelle: string;
  lettrable: boolean;
}

// Résout une liste de numéros de compte (ex: ["44566", "445711"]) vers leurs id
// internes Pennylane. Nécessaire car aucun autre endpoint ne filtre par numéro
// de compte directement — confirmé sur trial_balance ET ledger_entry_lines.
export async function resolveLedgerAccounts(
  client: PennylaneClient,
  numeros: string[]
): Promise<Map<string, CompteResolu>> {
  const response = await client.get<PennylaneLedgerAccountsResponse>(LEDGER_ACCOUNTS_PATH, {
    filter: JSON.stringify([{ field: 'number', operator: 'in', value: numeros }]),
    use_2026_api_changes: true,
  });

  const resultat = new Map<string, CompteResolu>();
  for (const item of response.items) {
    resultat.set(item.number, mapCompte(item));
  }
  return resultat;
}

function mapCompte(item: PennylaneLedgerAccountItem): CompteResolu {
  return {
    id: item.id,
    numero: item.number,
    libelle: item.label,
    lettrable: item.letterable,
  };
}

// Découvre tous les comptes dont le numéro commence par un préfixe donné
// (ex: '445' pour toute la famille TVA) — utilise l'opérateur start_with,
// documenté dans le schéma de l'endpoint. Sert à l'onboarding (Module 3) :
// on ne connaît pas encore la liste exacte des comptes TVA d'un nouveau
// dossier, contrairement au fonctionnement courant où elle est déjà connue.
// Paginé, contrairement aux deux fonctions ci-dessus : une recherche par
// préfixe peut légitimement remonter beaucoup de comptes.
export async function decouvrirComptesParPrefixe(
  client: PennylaneClient,
  prefixe: string
): Promise<CompteResolu[]> {
  const comptes: CompteResolu[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.get<PennylaneLedgerAccountsResponse>(LEDGER_ACCOUNTS_PATH, {
      filter: JSON.stringify([{ field: 'number', operator: 'start_with', value: prefixe }]),
      use_2026_api_changes: true,
      limit: 100,
      cursor,
    });

    comptes.push(...response.items.map(mapCompte));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return comptes;
}
// Symétrique de resolveLedgerAccounts, mais par id plutôt que par numéro.
// Utile pour récupérer le libellé (nom de tiers en pratique — confirmé : les
// cabinets nomment soigneusement leurs comptes auxiliaires) de comptes
// découverts dynamiquement en décomposant une pièce (ex: "411ROUSSEAU" trouvé
// dans fetchLignesDePiece, dont on ne connaît que le numéro et l'id, pas le
// libellé). Batchable : un seul appel pour plusieurs comptes à la fois.
export async function resolveLedgerAccountsByIds(
  client: PennylaneClient,
  ids: number[]
): Promise<Map<number, CompteResolu>> {
  const resultat = new Map<number, CompteResolu>();
  if (ids.length === 0) {
    return resultat;
  }

  const response = await client.get<PennylaneLedgerAccountsResponse>(LEDGER_ACCOUNTS_PATH, {
    filter: JSON.stringify([{ field: 'id', operator: 'in', value: ids }]),
    use_2026_api_changes: true,
  });

  for (const item of response.items) {
    resultat.set(item.id, mapCompte(item));
  }
  return resultat;
}
