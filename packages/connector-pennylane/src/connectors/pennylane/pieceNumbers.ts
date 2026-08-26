import { PennylaneClient } from './client.js';

const LEDGER_ENTRIES_PATH = '/api/external/v2/ledger_entries';

interface PennylaneLedgerEntryItem {
  id: number;
  piece_number?: string | null;
}

interface PennylaneLedgerEntriesResponse {
  items: PennylaneLedgerEntryItem[];
  has_more: boolean;
  next_cursor: string | null;
}

// Le "numéro de pièce" (piece_number) vit sur l'ÉCRITURE (ledger_entry),
// jamais sur une ligne — distinct du libellé de ligne (label), qui est un
// texte libre non structuré. Confirmé par Rami (10/08) sur les VENTES
// spécifiquement : systématiquement saisi avec le vrai numéro de facture,
// jamais une référence auto-générée par Pennylane (contrairement aux
// achats, où c'est peu soigné) — c'est précisément ce dont a besoin le
// contrôle de trou de numérotation (Module 5), qui ne porte que sur les
// ventes.
//
// À VÉRIFIER EN CONDITIONS RÉELLES : le nom exact du champ JSON
// (`piece_number`) est construit à partir de la documentation Pennylane
// (changelog + forum communautaire), pas d'un exemple de réponse brute
// observé directement — contrairement aux autres champs déjà confirmés
// par la pratique dans ce connecteur.
//
// GET /ledger_entries ne permet pas de filtrer PAR piece_number (limite
// documentée de l'API), mais permet de filtrer par id avec l'opérateur
// 'in' — on récupère donc les écritures déjà identifiées par ailleurs
// (ledgerEntryId), pas une recherche large.
export async function fetchPieceNumbers(
  client: PennylaneClient,
  ledgerEntryIds: number[]
): Promise<Map<number, string | null>> {
  const resultat = new Map<number, string | null>();
  if (ledgerEntryIds.length === 0) {
    return resultat;
  }

  const filtre = [{ field: 'id', operator: 'in', value: ledgerEntryIds }];
  let cursor: string | undefined;

  do {
    const response = await client.get<PennylaneLedgerEntriesResponse>(LEDGER_ENTRIES_PATH, {
      filter: JSON.stringify(filtre),
      limit: 100,
      cursor,
    });

    for (const item of response.items) {
      resultat.set(item.id, item.piece_number ?? null);
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return resultat;
}
