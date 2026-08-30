import type { IPennylaneApiClient } from './client.js';
import type { PennylaneLedgerEntryLineItem, PennylaneLedgerEntryLinesResponse } from './types.js';
import type { LigneEcritureAvecLettrage } from '@tva-controle/core';

const LEDGER_ENTRY_LINES_PATH = '/api/external/v2/ledger_entry_lines';

export interface FetchLignesParCompteParams {
  compteIds: number[];
  periodeDebut: string; // YYYY-MM-DD
  periodeFin: string;
}

function parseMontant(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Montant Pennylane invalide, non numérique : "${value}"`);
  }
  return parsed;
}

function mapLigne(item: PennylaneLedgerEntryLineItem): LigneEcritureAvecLettrage {
  return {
    id: item.id,
    compte: item.ledger_account.number,
    compteId: item.ledger_account.id,
    libelle: item.label ?? null,
    debit: parseMontant(item.debit),
    credit: parseMontant(item.credit),
    date: item.date,
    ledgerEntryId: item.ledger_entry.id,
    lettrage: {
      estLettree: item.lettered_ledger_entry_lines.ids.length > 0,
      groupeIds: item.lettered_ledger_entry_lines.ids,
    },
  };
}

// Récupère toutes les lignes d'écriture touchant les comptes donnés sur la période.
// Suit la pagination cursor jusqu'à épuisement.
export async function fetchLignesParCompte(
  client: IPennylaneApiClient,
  params: FetchLignesParCompteParams
): Promise<LigneEcritureAvecLettrage[]> {
  const lignes: LigneEcritureAvecLettrage[] = [];
  let cursor: string | undefined;

  const filtre = [
    { field: 'ledger_account_id', operator: 'in', value: params.compteIds },
    { field: 'date', operator: 'gteq', value: params.periodeDebut },
    { field: 'date', operator: 'lteq', value: params.periodeFin },
  ];

  do {
    const response = await client.get<PennylaneLedgerEntryLinesResponse>(LEDGER_ENTRY_LINES_PATH, {
      filter: JSON.stringify(filtre),
      use_2026_api_changes: true,
      limit: 100,
      cursor,
    });

    lignes.push(...response.items.map(mapLigne));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return lignes;
}
