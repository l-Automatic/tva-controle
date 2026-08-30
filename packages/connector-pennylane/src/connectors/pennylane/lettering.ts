import type { IPennylaneApiClient } from './client.js';
import type { PennylaneLedgerEntryLineItem, PennylaneLedgerEntryLinesResponse } from './types.js';
import type { Lettrage, LigneGroupeLettrage } from '@tva-controle/core';

const LEDGER_ENTRY_LINES_PATH = '/api/external/v2/ledger_entry_lines';

function parseMontant(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Montant Pennylane invalide, non numérique : "${value}"`);
  }
  return parsed;
}

// L'endpoint /ledger_entries/{id}/ledger_entry_lines ne donne pas le lettrage.
// Cette fonction récupère le lettrage pour un ensemble précis de lignes
// (typiquement les lignes 411/401 identifiées comme contreparties de lignes
// TVA) via l'endpoint général, filtré par id — batchable en un seul appel
// plutôt qu'un appel par pièce.
export async function fetchLettrage(
  client: IPennylaneApiClient,
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

// Récupère le détail complet (montant, libellé, date) des lignes d'un groupe
// de lettrage — nécessaire pour calculer un prorata de paiement partiel
// (ex: facture 1200€ dont 600€ payés -> 50% de la TVA déductible), ce que
// fetchLettrage seul ne permet pas : il ne renvoie que les ids du groupe
// (Lettrage.groupeIds), jamais leurs montants. Même endpoint que
// fetchLettrage, projection plus riche du même item — appeler cette
// fonction avec les groupeIds obtenus via fetchLettrage, pas l'inverse.
export async function fetchLignesGroupeLettrage(
  client: IPennylaneApiClient,
  ligneIds: number[]
): Promise<LigneGroupeLettrage[]> {
  if (ligneIds.length === 0) {
    return [];
  }

  const filtre = [{ field: 'id', operator: 'in', value: ligneIds }];
  const lignes: LigneGroupeLettrage[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.get<PennylaneLedgerEntryLinesResponse>(LEDGER_ENTRY_LINES_PATH, {
      filter: JSON.stringify(filtre),
      use_2026_api_changes: true,
      limit: 100,
      cursor,
    });

    lignes.push(...response.items.map(mapLigneGroupeLettrage));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return lignes;
}

function mapLigneGroupeLettrage(item: PennylaneLedgerEntryLineItem): LigneGroupeLettrage {
  return {
    id: item.id,
    compte: item.ledger_account.number,
    compteId: item.ledger_account.id,
    libelle: item.label ?? null,
    debit: parseMontant(item.debit),
    credit: parseMontant(item.credit),
    date: item.date,
  };
}
