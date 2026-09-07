import type { IPennylaneApiClient } from './client.js';
import type { PennylaneJournalItem, PennylaneJournalsResponse } from './types.js';

const JOURNALS_PATH = '/api/external/v2/journals';

export interface JournalResolu {
  id: number;
  code: string;
  label: string;
}

// Résout une liste d'id de journaux Pennylane vers leur code/libellé réel —
// nécessaire car le journal d'une écriture n'apparaît, dans la réponse
// ledger_entry_lines, que sous la forme { id, url } (cf. PennylaneTvaLedgerLineItem)
// jamais un code exploitable directement.
//
// Bug réel corrigé (10/08, confirmé par une vraie erreur 400 en conditions
// réelles) : l'endpoint /journals ne filtre QUE sur le champ "type" — jamais
// "id", contrairement à /ledger_accounts qui accepte les deux. Filtrer par
// id renvoie {"error":"Field \"id\" is not allowed for filter. Allowed
// fields are \"type\""}. Corrigé en récupérant TOUS les journaux du dossier
// (paginé, sans filtre), puis en filtrant côté client — un cabinet a en
// pratique une poignée de journaux (une dizaine, jamais des centaines),
// donc ça reste un coût réseau négligeable, jamais la peine de tenter une
// autre approche plus complexe.
export async function resolveJournalsByIds(
  client: IPennylaneApiClient,
  ids: number[]
): Promise<Map<number, JournalResolu>> {
  const resultat = new Map<number, JournalResolu>();
  if (ids.length === 0) {
    return resultat;
  }
  const idsRecherches = new Set(ids);

  let cursor: string | undefined;
  do {
    const response = await client.get<PennylaneJournalsResponse>(JOURNALS_PATH, {
      use_2026_api_changes: true,
      limit: 100,
      cursor,
    });

    for (const item of response.items) {
      if (idsRecherches.has(item.id)) {
        resultat.set(item.id, mapJournal(item));
      }
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return resultat;
}

function mapJournal(item: PennylaneJournalItem): JournalResolu {
  return { id: item.id, code: item.code, label: item.label };
}
