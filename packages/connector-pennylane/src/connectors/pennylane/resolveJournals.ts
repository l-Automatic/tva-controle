import type { IPennylaneApiClient } from './client.js';
import type { PennylaneJournalItem, PennylaneJournalsResponse } from './types.js';

// Hypothèse à vérifier en conditions réelles (10/08) : chemin par cohérence
// avec /ledger_accounts — à ajuster si l'appel réel révèle un chemin
// différent.
const JOURNALS_PATH = '/api/external/v2/journals';

export interface JournalResolu {
  id: number;
  code: string;
  label: string;
}

// Résout une liste d'id de journaux Pennylane vers leur code/libellé réel —
// nécessaire car le journal d'une écriture n'apparaît, dans la réponse
// ledger_entry_lines, que sous la forme { id, url } (cf. PennylaneTvaLedgerLineItem)
// jamais un code exploitable directement. Même principe et même garde-fou de
// pagination que resolveLedgerAccountsByIds (Module 3, bug réel trouvé sur un
// dossier électricien) — sans pagination, une résolution incomplète serait
// silencieuse, jamais une erreur visible.
export async function resolveJournalsByIds(
  client: IPennylaneApiClient,
  ids: number[]
): Promise<Map<number, JournalResolu>> {
  const resultat = new Map<number, JournalResolu>();
  if (ids.length === 0) {
    return resultat;
  }

  let cursor: string | undefined;
  do {
    const response = await client.get<PennylaneJournalsResponse>(JOURNALS_PATH, {
      filter: JSON.stringify([{ field: 'id', operator: 'in', value: ids }]),
      use_2026_api_changes: true,
      limit: 100,
      cursor,
    });

    for (const item of response.items) {
      resultat.set(item.id, mapJournal(item));
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return resultat;
}

function mapJournal(item: PennylaneJournalItem): JournalResolu {
  return { id: item.id, code: item.code, label: item.label };
}
