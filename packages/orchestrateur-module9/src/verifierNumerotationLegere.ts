import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes, fetchPieceNumbers } from '@tva-controle/connector-pennylane';
import { detecterTrousNumerotation } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionObjet } from './db/dossierRepository.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère des trous/doublons de numérotation
// (10/08) — "Vérifier à nouveau", même principe que les précédents, mais
// plus simple ici : aucun ajustement du calcul (ces deux anomalies n'ont
// jamais d'impact sur le montant de TVA, uniquement informatives), et
// aucune qualification préalable requise — directement sur les anomalies
// ouvertes, comme tva_hotel_a_tort. Rejoue simplement la détection
// déterministe sur des données fraîches ; enregistrerAnomaliesPartielles
// se charge déjà de remplacer le contenu (numéros toujours manquants
// gardés, ceux corrigés disparaissent, l'anomalie entière disparaît si
// plus rien ne manque) — rien de plus à construire pour ça.
export interface ParametresVerificationNumerotation {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function verifierNumerotationLegere(
  pool: Pool,
  params: ParametresVerificationNumerotation
): Promise<{ trouOuvert: boolean; doublonOuvert: boolean }> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const motifNumerotationBrut = conventionObjet(contexteDossier, 'motif_numerotation_facture');
  if (!motifNumerotationBrut || typeof motifNumerotationBrut !== 'object') {
    return { trouOuvert: false, doublonOuvert: false };
  }

  const balance = await fetchTrialBalance(params.client, {
    dossierId: params.dossierId,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });
  const comptesTva = filterComptesParPrefixe(balance, ['445'])
    .filter((c) => c.debit !== 0 || c.credit !== 0)
    .map((c) => c.numeroCompte);
  const ecritures = await fetchEcrituresTvaCompletes(params.client, {
    comptesTva,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  const ledgerEntryIdsVente = [
    ...new Set(ecritures.filter((e) => e.ligneTva.compte.startsWith('44571')).map((e) => e.ligneTva.ledgerEntryId)),
  ];
  const pieceNumbersVente = await fetchPieceNumbers(params.client, ledgerEntryIdsVente);

  const anomaliesFraiches = detecterTrousNumerotation(
    ledgerEntryIdsVente.map((id) => ({ ledgerEntryId: id, numeroPiece: pieceNumbersVente.get(id) ?? null })),
    motifNumerotationBrut as { prefixe: string; suffixe: string; nombreChiffres: number | null }
  );

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['trou_numerotation_facture', 'doublon_numerotation_facture'],
      anomaliesFraiches
    )
  );

  return {
    trouOuvert: anomaliesFraiches.some((a) => a.type === 'trou_numerotation_facture'),
    doublonOuvert: anomaliesFraiches.some((a) => a.type === 'doublon_numerotation_facture'),
  };
}
