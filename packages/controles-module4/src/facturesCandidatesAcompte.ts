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
// par Rami) : identifie toute facture de service dont le lien avec ses
// paiements n'est PAS clairement établi — jamais lettrée du tout, OU
// lettrée mais dans un groupe ambigu de plus de 2 pièces (fusion des deux
// anciens mécanismes distincts en un seul). Remplace complètement l'ancien
// jugement automatique sur "groupe de lettrage" — terme volontairement
// absent d'ici — par une résolution manuelle (popup, coche par
// candidat, précochage IA) avant qu'un cycle puisse être lancé.
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
    // 10/08 — étendu (remplace l'ancien mécanisme "groupe de lettrage à
    // plus de 2 lignes", terme volontairement absent d'ici, demande de
    // Rami) : une facture DÉJÀ lettrée mais dans un groupe de plus de 2
    // pièces reste ambiguë (plusieurs factures/paiements mélangés, lien
    // exact pas garanti) — candidate au même titre qu'une facture jamais
    // lettrée. Seul un lettrage à EXACTEMENT 2 pièces (la facture + son
    // unique paiement) est un cas clair, jamais candidat ici.
    const estLettreeSansAmbiguite =
      ligneTiers.lettrage.estLettree && ligneTiers.lettrage.groupeIds.length <= 2;
    if (estLettreeSansAmbiguite) continue;

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
