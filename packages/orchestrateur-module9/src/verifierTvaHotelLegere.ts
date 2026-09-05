import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes, resolveLedgerAccounts } from '@tva-controle/connector-pennylane';
import { verifierCoherenceTvaHotel } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { listerAnomalies } from './db/readRepository.js';
import { appliquerCorrectionTvaHotel } from './db/writeRepository.js';

// Vérification ciblée et légère des deux anomalies TVA hôtel (10/08) —
// "Vérifier à nouveau", même principe que les mécanismes précédents.
// Traite les deux types différemment, cohérent avec leurs circuits de
// résolution distincts (demande de Rami) :
// - tva_hotel_a_tort (déterministe, bloquant) : pas de qualification
//   préalable — vérifie directement les anomalies OUVERTES.
// - tva_hotel_a_verifier (jugement IA, signalé) : nécessite d'abord
//   qualifierTvaHotel('confirme') — vérifie les anomalies RÉSOLUES
//   (déjà confirmées, en attente de correction externe).
export interface ParametresVerificationTvaHotel {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
  utilisateurId: string;
}

export async function verifierTvaHotelLegere(
  pool: Pool,
  params: ParametresVerificationTvaHotel
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
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
  const ligneParId = new Map(ecritures.map((e) => [e.ligneTva.ledgerEntryId, e.ligneTva]));

  // tva_hotel_a_tort : rejoue le contrôle déterministe sur des données
  // fraîches — a besoin des noms de comptes fournisseur résolus, comme au
  // moment de la détection originale.
  const comptesFournisseurConcernes = [
    ...new Set(
      ecritures
        .filter((e) => e.ligneTva.compte.startsWith('44566'))
        .map((e) => e.lignesTiers[0]?.compte)
        .filter((c): c is string => c !== undefined)
    ),
  ];
  const nomsComptesFournisseur =
    comptesFournisseurConcernes.length > 0
      ? new Map(
          [...(await resolveLedgerAccounts(params.client, comptesFournisseurConcernes)).entries()].map(
            ([numero, resolu]) => [numero, resolu.libelle]
          )
        )
      : new Map<string, string>();
  const anomaliesFraichesTort = verifierCoherenceTvaHotel(ecritures, nomsComptesFournisseur);
  const idsEncoreDetectesTort = new Set(anomaliesFraichesTort.map((a) => a.ledgerEntryId));

  const anomaliesOuvertesTort = (
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      listerAnomalies(client, params.dossierId, { periode: params.periodeDebut, statut: 'ouvert' })
    )
  ).filter((a) => a.typeAnomalie === 'tva_hotel_a_tort');

  const anomaliesResoluesVerifier = (
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      listerAnomalies(client, params.dossierId, { periode: params.periodeDebut, statut: 'resolu' })
    )
  ).filter((a) => a.typeAnomalie === 'tva_hotel_a_verifier');

  let corrections = 0;
  let toujoursOuvertes = 0;

  // tva_hotel_a_tort : directement sur les anomalies ouvertes.
  for (const ancienne of anomaliesOuvertesTort) {
    const ledgerEntryId = Number(ancienne.referencePiece);
    if (idsEncoreDetectesTort.has(ledgerEntryId)) {
      toujoursOuvertes += 1;
      continue;
    }
    const details = ancienne.details as { montantTva?: number } | null;
    const montantTva = details?.montantTva ?? 0;
    if (montantTva <= 0) continue;

    await avecContexteCabinet(pool, params.cabinetId, async (client) => {
      await appliquerCorrectionTvaHotel(
        client,
        params.dossierId,
        params.periodeDebut,
        montantTva,
        `TVA hôtel corrigée (vérifié à nouveau) : ${montantTva.toFixed(2)} € retirés de la TVA déductible.`,
        params.utilisateurId
      );
      await client.query(`UPDATE anomalies SET statut = 'obsolete' WHERE id = $1`, [ancienne.id]);
    });
    corrections += 1;
  }

  // tva_hotel_a_verifier : sur les anomalies déjà confirmées (résolu via
  // qualifierTvaHotel('confirme')) — vérifie si la TVA est toujours
  // déduite sur cette ligne précise (pas besoin de rejouer le jugement
  // IA, le libellé n'a aucune raison d'avoir changé de sens).
  for (const ancienne of anomaliesResoluesVerifier) {
    const ledgerEntryId = Number(ancienne.referencePiece);
    const nouveauDebit = ligneParId.get(ledgerEntryId)?.debit ?? 0;
    if (nouveauDebit > 0) continue; // toujours déduit, rien de corrigé

    const details = ancienne.details as { montantTva?: number } | null;
    const montantTva = details?.montantTva ?? 0;
    if (montantTva <= 0) continue;

    await avecContexteCabinet(pool, params.cabinetId, async (client) => {
      await appliquerCorrectionTvaHotel(
        client,
        params.dossierId,
        params.periodeDebut,
        montantTva,
        `TVA hôtel corrigée (vérifié à nouveau) : ${montantTva.toFixed(2)} € retirés de la TVA déductible.`,
        params.utilisateurId
      );
      await client.query(`UPDATE anomalies SET statut = 'obsolete' WHERE id = $1`, [ancienne.id]);
    });
    corrections += 1;
  }

  return { anomaliesOuvertes: toujoursOuvertes, corrections };
}
