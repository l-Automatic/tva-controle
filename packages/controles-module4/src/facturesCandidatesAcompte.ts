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

// Chantier paiement partiel achats, volet "sans lettrage" (10/08) — confirmé
// par Rami : il n'existe pas en pratique de lettrage partiel/en attente
// dans Pennylane. Un acompte réel se traduit donc par une facture ET un
// paiement TOUS LES DEUX non lettrés, sans aucun lien structurel entre
// eux — contrairement au cas d'un groupe de lettrage à plus de 2 lignes
// (paiementPartielAchat.ts / jugerPaiementPartielAchat, toujours valable
// pour le cas où plusieurs factures sont réglées ensemble en une fois).
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
    if (ligneTiers.lettrage.estLettree) continue; // déjà lettrée : traitée par le contrôle existant, pas ici

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
