import type { EcritureTvaComplete } from '@tva-controle/core';

export interface FactureCandidateAcompte {
  ledgerEntryId: number;
  compteTva: string;
  compteTiers: string;
  compteTiersId: number;
  date: string;
  libelle: string | null;
  montantTva: number;
  montantFactureTotal: number; // montant TTC dû au fournisseur (ligneTiers.credit)
}

// Chantier rapprochement paiement achats (10/08, refonte complète demandée
// par Rami) : identifie toute facture de service JAMAIS lettrée — le
// lettrage chez Pennylane est tout ou rien (confirmé par Rami), un
// groupe lettré équilibre forcément à zéro quelle que soit sa taille,
// donc jamais ambigu une fois lettré. Seule une facture non lettrée
// reste une vraie question ouverte : soit vraiment pas encore payée,
// soit payée mais jamais rapprochée par erreur dans Pennylane. Remplace
// complètement l'ancien jugement automatique — terme "groupe de
// lettrage" volontairement absent d'ici — par une résolution manuelle
// (popup, coche par candidat, précochage IA) avant qu'un cycle puisse
// être lancé.
//
// Pré-filtre déterministe, avant tout appel LLM (coûteux s'il fallait
// l'appliquer à chaque facture non lettrée) : SEULEMENT les factures de
// SERVICE (comptes_charge_service confirmé) — un bien n'a jamais de TVA
// sur acompte à traiter (art. 269-2-a CGI, acompte sur bien = 0% de TVA
// due, la question ne se pose même pas).
export function identifierFacturesCandidatesAcompte(
  ecritures: EcritureTvaComplete[],
  comptesChargeService: string[],
  ledgerEntryIdsExceptionPaiementComptant: Set<number> = new Set()
): FactureCandidateAcompte[] {
  const candidates: FactureCandidateAcompte[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const ligneTiers = ecriture.lignesTiers[0];
    if (!ligneTiers) continue;
    // Correctif (10/08) : ma première extension de cette fonction (le
    // 10/08, plus tôt le même jour) traitait des lignes rapprochées à
    // plus de 2 pièces comme ambiguës, par analogie avec l'ancien
    // mécanisme retiré — erreur de raisonnement, corrigée immédiatement
    // après que Rami l'ait relevée. Le lettrage chez Pennylane est tout
    // ou rien (confirmé par Rami plus tôt dans le projet) : des lignes
    // rapprochées ensemble équilibrent forcément à zéro, quel que soit
    // leur nombre — tout ce qu'elles contiennent est donc réglé. Seule une
    // facture JAMAIS lettrée reste une vraie ambiguïté (le cas d'acompte
    // sans lettrage décrit à l'origine par Rami).
    if (ligneTiers.lettrage.estLettree) continue;

    // Un hôtel identifié comme exception au "paiement comptant" (625) est
    // candidat même si 625 n'est pas dans comptes_charge_service — c'est
    // justement le cas où la nature service n'est pas la question, seul le
    // fait qu'un hôtel peut être payé en deux fois compte ici.
    const estExceptionForcee = ledgerEntryIdsExceptionPaiementComptant.has(ecriture.ligneTva.ledgerEntryId);

    const toucheChargeService = ecriture.autresLignes.some((l) =>
      comptesChargeService.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (!toucheChargeService && !estExceptionForcee) continue; // jamais un bien, sauf exception forcée

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    if (montantTva === 0) continue;

    candidates.push({
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      compteTva: ecriture.ligneTva.compte,
      compteTiers: ligneTiers.compte,
      compteTiersId: ligneTiers.compteId,
      date: ecriture.ligneTva.date,
      libelle: ecriture.ligneTva.libelle,
      montantTva,
      montantFactureTotal: Math.abs(ligneTiers.debit - ligneTiers.credit),
    });
  }

  return candidates;
}
