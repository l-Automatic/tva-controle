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
  comptesChargeService: string[]
): FactureCandidateAcompte[] {
  const candidates: FactureCandidateAcompte[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const ligneTiers = ecriture.lignesTiers[0];
    if (!ligneTiers) continue;
    if (ligneTiers.lettrage.estLettree) continue; // déjà lettrée : traitée par le contrôle existant, pas ici

    const toucheChargeService = ecriture.autresLignes.some((l) =>
      comptesChargeService.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (!toucheChargeService) continue; // jamais un bien

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
