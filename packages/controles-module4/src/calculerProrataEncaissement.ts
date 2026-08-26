import type { LigneGroupeLettrage } from '@tva-controle/core';

// Module 5, volet ventes (10/08) — purement arithmétique, aucune IA
// nécessaire : contrairement aux achats (où il faut d'abord établir par
// jugement quel paiement se rattache à quelle facture), côté ventes le
// groupe de lettrage donne déjà tous les montants nécessaires, tous
// rattachés à la même ligne tiers.
//
// Convention de sens (compte client, 411) : une facture de vente CRÉDITE
// le compte tiers, un encaissement reçu le DÉBITE. Le prorata exigible
// cette période = total débité (encaissé) / total crédité (facturé).
//
// Plafonné à 1 (jamais plus de 100% exigible, même en cas de sur-paiement
// apparent — un dépassement signale plutôt une erreur de lettrage qu'un
// vrai trop-perçu à traiter ici).
export function calculerProrataEncaissement(lignesGroupe: LigneGroupeLettrage[]): number {
  const totalFacture = lignesGroupe.reduce((somme, l) => somme + l.credit, 0);
  const totalEncaisse = lignesGroupe.reduce((somme, l) => somme + l.debit, 0);

  if (totalFacture === 0) return 1; // rien à facturer dans ce groupe : ne pas exclure par prudence

  return Math.min(totalEncaisse / totalFacture, 1);
}
