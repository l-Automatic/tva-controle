import type { IPennylaneApiClient } from './client.js';
import type { PennylaneTrialBalanceItem, PennylaneTrialBalanceResponse } from './types.js';
import type { BalanceComptable, CompteSolde } from '@tva-controle/core';

const TRIAL_BALANCE_PATH = '/api/external/v2/trial_balance';

export interface FetchTrialBalanceParams {
  dossierId: string; // identifiant interne pivot — le token scope déjà l'entreprise côté Pennylane
  periodeDebut: string; // YYYY-MM-DD
  periodeFin: string;
  isAuxiliary?: boolean;
}

// Les montants arrivent en string côté API Pennylane (documenté et vérifié) ;
// on échoue fort plutôt que de laisser passer un NaN silencieux dans un calcul fiscal.
function parseMontant(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Montant Pennylane invalide, non numérique : "${value}"`);
  }
  return parsed;
}

function mapItem(item: PennylaneTrialBalanceItem): CompteSolde {
  return {
    numeroCompte: item.number,
    numeroCompteFormate: item.formatted_number,
    libelle: item.label,
    debit: parseMontant(item.debits),
    credit: parseMontant(item.credits),
  };
}

export async function fetchTrialBalance(
  client: IPennylaneApiClient,
  params: FetchTrialBalanceParams
): Promise<BalanceComptable> {
  const comptes: CompteSolde[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.get<PennylaneTrialBalanceResponse>(TRIAL_BALANCE_PATH, {
      period_start: params.periodeDebut,
      period_end: params.periodeFin,
      use_2026_api_changes: true,
      limit: 1000,
      is_auxiliary: params.isAuxiliary,
      cursor,
    });

    comptes.push(...response.items.map(mapItem));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return {
    dossierId: params.dossierId,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
    comptes,
  };
}

// Le filtrage par compte n'existe pas côté API (confirmé) — utilitaire côté client.
export function filterComptesParPrefixe(
  balance: BalanceComptable,
  prefixes: string[]
): CompteSolde[] {
  return balance.comptes.filter((c) => prefixes.some((p) => c.numeroCompte.startsWith(p)));
}
