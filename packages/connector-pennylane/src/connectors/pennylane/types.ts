// Ces types reflètent la forme brute renvoyée par l'API Pennylane, telle
// qu'observée en environnement réel (Company API v2). Ils ne doivent JAMAIS
// être utilisés en dehors du dossier connectors/pennylane — tout ce qui sort
// de ce dossier passe par le format pivot (../../types/pivot.ts).

export interface PennylaneTrialBalanceItem {
  number: string;
  formatted_number: string;
  label: string;
  debits: string; // string côté API, à parser — piège documenté
  credits: string;
}

export interface PennylaneTrialBalanceResponse {
  items: PennylaneTrialBalanceItem[];
  total_pages: number | null;
  current_page: number | null;
  per_page: number | null;
  total_items: number | null;
  has_more: boolean;
  next_cursor: string | null;
}

// --- Ledger accounts (GET /ledger_accounts) ---

export interface PennylaneLedgerAccountItem {
  id: number;
  number: string;
  label: string;
  vat_rate: string;
  country_alpha2: string;
  enabled: boolean;
  type: string;
  letterable: boolean;
  created_at: string;
  updated_at: string;
}

export interface PennylaneLedgerAccountsResponse {
  items: PennylaneLedgerAccountItem[];
  has_more: boolean | null;
  next_cursor: string | null;
}

// --- Ledger entry lines — endpoint général (GET /ledger_entry_lines) ---
// Seul cet endpoint expose lettered_ledger_entry_lines. Confirmé sur données réelles :
// vide sur les comptes 445xx (jamais lettrables en pratique), rempli sur 411/401.

export interface PennylaneLedgerEntryLineItem {
  id: number;
  debit: string;
  credit: string;
  label: string;
  date: string;
  created_at: string;
  updated_at: string;
  journal: { id: number; url: string };
  ledger_account: { id: number; number: string; url: string };
  ledger_entry: { id: number };
  lettered_ledger_entry_lines: { ids: number[]; url: string };
}

export interface PennylaneLedgerEntryLinesResponse {
  items: PennylaneLedgerEntryLineItem[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Lignes d'une pièce donnée (GET /ledger_entries/{id}/ledger_entry_lines) ---
// Schéma DIFFÉRENT et plus pauvre que l'endpoint général — confirmé dans la doc
// et sur données réelles : pas de date, pas de journal, pas de lettrage ici.

export interface PennylanePieceLineItem {
  id: number;
  debit: string;
  credit: string;
  label: string;
  ledger_account_id: number;
  ledger_account: { id: number; number: string; url: string };
}

export interface PennylanePieceLinesResponse {
  items: PennylanePieceLineItem[];
  has_more: boolean | null;
  next_cursor: string | null;
}
