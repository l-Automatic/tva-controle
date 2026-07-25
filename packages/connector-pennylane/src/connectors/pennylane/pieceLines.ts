import { PennylaneClient } from './client.js';
import type { PennylanePieceLineItem, PennylanePieceLinesResponse } from './types.js';
import type { LigneEcritureBrute } from '@tva-controle/core';

const PIECE_LINES_PATH = (ledgerEntryId: number) =>
  `/api/external/v2/ledger_entries/${ledgerEntryId}/ledger_entry_lines`;

// Alias local pour lisibilité dans ce fichier — même type que celui exposé
// publiquement dans EcritureTvaComplete.autresLignes (pivot), pas une forme
// dupliquée : une pièce déborde forcément dans les deux usages.
type LignePiece = LigneEcritureBrute;
export type { LignePiece };

function parseMontant(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Montant Pennylane invalide, non numérique : "${value}"`);
  }
  return parsed;
}

function mapLignePiece(item: PennylanePieceLineItem): LignePiece {
  return {
    id: item.id,
    compte: item.ledger_account.number,
    compteId: item.ledger_account.id,
    libelle: item.label ?? null,
    debit: parseMontant(item.debit),
    credit: parseMontant(item.credit),
  };
}

// IMPORTANT : ce schéma de réponse n'inclut PAS le lettrage (confirmé dans la
// doc et sur données réelles) — contrairement à l'endpoint général
// /ledger_entry_lines. Pour connaître le lettrage d'une ligne trouvée ici,
// il faut la rappeler via fetchLettrage() avec son id.
export async function fetchLignesDePiece(
  client: PennylaneClient,
  ledgerEntryId: number
): Promise<LignePiece[]> {
  const lignes: LignePiece[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.get<PennylanePieceLinesResponse>(PIECE_LINES_PATH(ledgerEntryId), {
      use_2026_api_changes: true,
      limit: 100,
      cursor,
    });

    lignes.push(...response.items.map(mapLignePiece));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return lignes;
}
