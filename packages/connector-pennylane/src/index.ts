export {
  PennylaneClient,
  PennylaneApiError,
  type IPennylaneApiClient,
} from './connectors/pennylane/client.js';
export {
  fetchTrialBalance,
  filterComptesParPrefixe,
  type FetchTrialBalanceParams,
} from './connectors/pennylane/trialBalance.js';
export {
  resolveLedgerAccounts,
  resolveLedgerAccountsByIds,
  decouvrirComptesParPrefixe,
  type CompteResolu,
} from './connectors/pennylane/ledgerAccounts.js';
export {
  fetchLignesParCompte,
  type FetchLignesParCompteParams,
} from './connectors/pennylane/tvaLedgerLines.js';
export { fetchLignesDePiece, type LignePiece } from './connectors/pennylane/pieceLines.js';
export { fetchLettrage, fetchLignesGroupeLettrage } from './connectors/pennylane/lettering.js';
export { fetchPieceNumbers } from './connectors/pennylane/pieceNumbers.js';
export { FirmApiClient, FirmApiError, type FirmApiClientConfig } from './connectors/pennylane/firmClient.js';
export { fetchDossiersCabinet, type DossierCabinet } from './connectors/pennylane/firmCompanies.js';
export {
  fetchEcrituresTvaCompletes,
  type FetchEcrituresTvaComptletesParams,
} from './connectors/pennylane/tvaEcrituresCompletes.js';
export type {
  BalanceComptable,
  CompteSolde,
  LigneEcriture,
  LigneEcritureAvecLettrage,
  LigneTiersAvecContexte,
  LigneEcritureBrute,
  EcritureTvaComplete,
  Lettrage,
} from '@tva-controle/core';
