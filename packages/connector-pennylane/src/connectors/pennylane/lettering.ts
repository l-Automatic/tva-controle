import { PennylaneClient } from './client.js';
import type { PennylaneLedgerEntryLineItem, PennylaneLedgerEntryLinesResponse } from './types.js';
import type { Lettrage } from '@tva-controle/core';

const LEDGER_ENTRY_LINES_PATH = '/api/external/v2/ledger_entry_lines';

// L'endpoint /ledger_entries/{id}/ledger_entry_lines ne donne pas le lettrage.
// Cette fonction récupère le lettrage pour un ensemble précis de lignes
// (typiquement les lignes 411/401 identifiées comme contreparties de lignes
// TVA) via l'endpoint général, filtré par id — batchable en un seul appel
// plutôt qu'un appel par pièce.
export async function fetchLettrage(
  client: PennylaneClient,
  ligneIds: number[]
): Promise<Map<number, Lettrage>> {
  const resultat = new Map<number, Lettrage>();
  if (ligneIds.length === 0) {
    return resultat;
  }

  const filtre = [{ field: 'id', operator: 'in', value: ligneIds }];
  let cursor: string | undefined;

  do {
    const response = await client.get<PennylaneLedgerEntryLinesResponse>(LEDGER_ENTRY_LINES_PATH, {
      filter: JSON.stringify(filtre),
      use_2026_api_changes: true,
      limit: 100,
      cursor,
    });

    for (const item of response.items) {
      resultat.set(item.id, mapLettrage(item));
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return resultat;
}

function mapLettrage(item: PennylaneLedgerEntryLineItem): Lettrage {
  return {
    estLettree: item.lettered_ledger_entry_lines.ids.length > 0,
    groupeIds: item.lettered_ledger_entry_lines.ids,
  };
}
