import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// Demande de Rami (10/08) : la TVA sur les frais d'hébergement (hôtels)
// n'est jamais déductible, quel que soit le montant mentionné sur la
// facture. En pratique, la personne qui saisit ne doit simplement pas
// passer de TVA sur ce type de dépense — si une TVA apparaît quand même,
// c'est une vraie erreur de saisie, pas une nuance d'appréciation. D'où
// une anomalie BLOQUANTE, comme pour le compte immobilisation mal
// rattaché.
//
// Détection PAR LE NOM DU COMPTE FOURNISSEUR (résolu via
// resolveLedgerAccounts côté appelant, jamais un libellé d'écriture au
// hasard — même correction que pour la présélection IA) : couvre le cas
// d'un compte fournisseur dédié aux hôtels (ex: "401HOTEL", libellé
// "HOTELS"). Ne couvre PAS le cas d'un compte fournisseur générique
// ("fournisseurs divers") où seul le libellé de l'écriture porte le nom de
// l'hôtel précis — ça demande une reconnaissance par LLM, prévu comme une
// extension séparée de ce contrôle, pas construit ici.
export function verifierCoherenceTvaHotel(
  ecritures: EcritureTvaComplete[],
  nomsComptesFournisseur: Map<string, string>
): Anomalie[] {
  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    if (montantTva === 0) continue;

    const ligneTiers = ecriture.lignesTiers[0];
    if (!ligneTiers) continue;

    const nomFournisseur = nomsComptesFournisseur.get(ligneTiers.compte);
    if (!nomFournisseur || !/h[ôo]tel/i.test(nomFournisseur)) continue;

    anomalies.push({
      type: 'tva_hotel_a_tort',
      gravite: 'bloquant',
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      compte: ecriture.ligneTva.compte,
      description:
        `TVA de ${montantTva.toFixed(2)}€ déduite sur une facture du fournisseur "${nomFournisseur}" ` +
        `(compte ${ligneTiers.compte}) : la TVA sur les frais d'hébergement n'est jamais déductible. ` +
        `À corriger dans Pennylane avant de poursuivre.`,
      details: { nomFournisseur, compteFournisseur: ligneTiers.compte, montantTva },
    });
  }

  return anomalies;
}
