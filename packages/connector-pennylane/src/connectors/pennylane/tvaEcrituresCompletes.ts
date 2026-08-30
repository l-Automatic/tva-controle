import type { IPennylaneApiClient } from './client.js';
import { resolveLedgerAccounts, resolveLedgerAccountsByIds } from './ledgerAccounts.js';
import { fetchLignesParCompte } from './tvaLedgerLines.js';
import { fetchLignesDePiece, type LignePiece } from './pieceLines.js';
import { fetchLettrage } from './lettering.js';
import { mapAvecConcurrenceLimitee } from './concurrency.js';
import type { EcritureTvaComplete, LigneTiersAvecContexte, LigneEcritureBrute } from '@tva-controle/core';

export interface FetchEcrituresTvaComptletesParams {
  comptesTva: string[]; // numéros de compte, ex: ["44562","44566","445711","445712","445713","4454","445664"]
  periodeDebut: string; // YYYY-MM-DD
  periodeFin: string;
  // Nombre de pièces récupérées en parallèle (fetchLignesDePiece = 1 appel/pièce).
  // Reste volontairement prudent face à la limite documentée de 25 req/5s :
  // même à 5 en parallèle, le client gère déjà les 429 avec retry automatique,
  // mais mieux vaut ne pas les provoquer inutilement.
  concurrencePieces?: number;
}

// Assemble, à partir des briques déjà validées séparément sur données réelles,
// les écritures TVA complètes avec leur contrepartie tiers (nom + lettrage).
//
// Coût réseau : 1 (comptes TVA) + 1..N (lignes TVA, paginé) + 1 par pièce
// distincte touchée + 1 (libellés tiers, batché) + 1 (lettrage, batché).
// Le terme "1 par pièce" est le seul qui grossit avec le volume d'écritures
// de la période — c'est le goulot d'étranglement à surveiller si un dossier
// a beaucoup d'activité.
export async function fetchEcrituresTvaCompletes(
  client: IPennylaneApiClient,
  params: FetchEcrituresTvaComptletesParams
): Promise<EcritureTvaComplete[]> {
  // 1. Résoudre les comptes TVA vers leurs id
  const comptesResolus = await resolveLedgerAccounts(client, params.comptesTva);
  const idsComptesTva = new Set([...comptesResolus.values()].map((c) => c.id));

  // 2. Lignes TVA de la période
  const lignesTva = await fetchLignesParCompte(client, {
    compteIds: [...idsComptesTva],
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  if (lignesTva.length === 0) {
    return [];
  }

  // 3. Pièces distinctes concernées
  const ledgerEntryIds = [...new Set(lignesTva.map((l) => l.ledgerEntryId))];

  // 4. Toutes les lignes de chaque pièce, en parallèle borné
  const lignesParPieceListe = await mapAvecConcurrenceLimitee(
    ledgerEntryIds,
    params.concurrencePieces ?? 5,
    (ledgerEntryId) => fetchLignesDePiece(client, ledgerEntryId)
  );
  const piecesParId = new Map<number, LignePiece[]>();
  ledgerEntryIds.forEach((id, i) => piecesParId.set(id, lignesParPieceListe[i] ?? []));

  // 5. Lignes candidates = tout ce qui n'est pas un compte TVA qu'on interroge.
  //    Le tri "tiers réel" se fait ensuite sur le champ lettrable (convention
  //    comptable PCG standard), pas sur un préfixe de compte propre au
  //    dossier — évite de dépendre d'une convention à mémoriser par cabinet.
  const candidatsParPiece = new Map<number, LignePiece[]>();
  for (const [ledgerEntryId, lignes] of piecesParId) {
    candidatsParPiece.set(
      ledgerEntryId,
      lignes.filter((l) => !idsComptesTva.has(l.compteId))
    );
  }

  const idsComptesCandidats = [
    ...new Set([...candidatsParPiece.values()].flat().map((l) => l.compteId)),
  ];
  const comptesCandidatsResolus = await resolveLedgerAccountsByIds(client, idsComptesCandidats);

  const lignesTiersParPiece = new Map<number, LignePiece[]>();
  const autresLignesParPiece = new Map<number, LignePiece[]>();
  for (const [ledgerEntryId, candidats] of candidatsParPiece) {
    const lettrables = candidats.filter((l) => comptesCandidatsResolus.get(l.compteId)?.lettrable === true);
    const nonLettrables = candidats.filter((l) => comptesCandidatsResolus.get(l.compteId)?.lettrable !== true);
    lignesTiersParPiece.set(ledgerEntryId, lettrables);
    autresLignesParPiece.set(ledgerEntryId, nonLettrables);
  }

  // 6. Lettrage réel de toutes les lignes tiers identifiées, en un seul lot
  const idsLignesTiers = [...lignesTiersParPiece.values()].flat().map((l) => l.id);
  const lettrageParLigne = await fetchLettrage(client, idsLignesTiers);

  // 7. Composition finale
  return lignesTva.map((ligneTva) => {
    const brutes = lignesTiersParPiece.get(ligneTva.ledgerEntryId) ?? [];
    const lignesTiers: LigneTiersAvecContexte[] = brutes.map((l) => {
      const lettrage = lettrageParLigne.get(l.id);
      if (!lettrage) {
        // Ne jamais supposer "non lettrée" par défaut sur une absence de
        // données — même logique que parseMontant : échouer fort plutôt que
        // produire un chiffre silencieusement faux dans un calcul fiscal.
        throw new Error(
          `Lettrage introuvable pour la ligne tiers id=${l.id} (pièce ${ligneTva.ledgerEntryId}) — incohérence entre fetchLignesDePiece et fetchLettrage`
        );
      }
      return {
        compte: l.compte,
        compteId: l.compteId,
        libelleCompte: comptesCandidatsResolus.get(l.compteId)?.libelle ?? null,
        debit: l.debit,
        credit: l.credit,
        lettrage,
      };
    });

    const autresLignesBrutes = autresLignesParPiece.get(ligneTva.ledgerEntryId) ?? [];
    const autresLignes: LigneEcritureBrute[] = autresLignesBrutes.map((l) => ({
      id: l.id,
      compte: l.compte,
      compteId: l.compteId,
      libelle: l.libelle,
      debit: l.debit,
      credit: l.credit,
    }));

    return {
      ligneTva,
      ledgerEntryId: ligneTva.ledgerEntryId,
      lignesTiers,
      autresLignes,
    };
  });
}
