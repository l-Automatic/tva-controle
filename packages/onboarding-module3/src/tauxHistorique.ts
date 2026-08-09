import type { EcritureTvaComplete } from '@tva-controle/core';

export interface PropositionTaux {
  compteOuTiers: string;
  tauxHabituel: number;
  nbOccurrences: number;
}

const TAUX_OFFICIELS = [20, 10, 5.5, 2.1];

// Arrondit vers le taux officiel le plus proche s'il est raisonnablement
// proche (tolère l'arrondi centime-à-centime), sinon garde la valeur brute —
// un taux qui ne colle à rien de connu est justement le genre de chose que
// la validation humaine doit examiner, pas que l'algorithme doit corriger.
export function normaliserTaux(valeur: number): number {
  for (const taux of TAUX_OFFICIELS) {
    if (Math.abs(valeur - taux) <= 0.5) return taux;
  }
  return Math.round(valeur * 10) / 10;
}

export function sommeNette(lignes: Array<{ debit: number; credit: number }>): number {
  return lignes.reduce((acc, l) => acc + (l.credit - l.debit), 0);
}

// Limitation connue, assumée pour cette v1 : contrairement à
// verifierCoherenceTauxCollecte (Module 4), cette analyse ne détecte pas les
// pièces multi-taux non éclatées avant de calculer le taux implicite — sur
// un historique de plusieurs mois, ce bruit reste marginal face au taux
// dominant, mais reste une simplification à noter.
export function analyserTauxHistorique(
  ecritures: EcritureTvaComplete[],
  seuilOccurrences = 3
): PropositionTaux[] {
  const histogrammeParCompte = new Map<string, Map<number, number>>();

  for (const ecriture of ecritures) {
    const { compte } = ecriture.ligneTva;
    const estConcerne =
      compte.startsWith('44571') || compte.startsWith('44566') || compte.startsWith('44562');
    if (!estConcerne) continue;

    const baseHT = Math.abs(sommeNette(ecriture.autresLignes));
    if (baseHT === 0) continue;

    const montantTva = Math.abs(ecriture.ligneTva.credit - ecriture.ligneTva.debit);
    const tauxImplicite = normaliserTaux((montantTva / baseHT) * 100);

    const histogramme = histogrammeParCompte.get(compte) ?? new Map<number, number>();
    histogramme.set(tauxImplicite, (histogramme.get(tauxImplicite) ?? 0) + 1);
    histogrammeParCompte.set(compte, histogramme);
  }

  const propositions: PropositionTaux[] = [];
  for (const [compte, histogramme] of histogrammeParCompte) {
    const dominant = [...histogramme.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominant) continue;
    const [tauxDominant, count] = dominant;
    if (count < seuilOccurrences) continue;
    propositions.push({ compteOuTiers: compte, tauxHabituel: tauxDominant, nbOccurrences: count });
  }

  return propositions;
}

export interface PropositionTauxTiers {
  numeroCompteTiers: string;
  tauxHabituel: number;
  nbOccurrences: number;
}

// Symétrique de analyserTauxHistorique, mais groupé par compte tiers
// (client) plutôt que par compte de collecte — chantier B : déterminer le
// taux à appliquer par défaut sur un encaissement client non lettré, sans
// facture en face. Ne regarde QUE le côté collecte (445711 family) : le
// taux "habituel d'un client" n'a de sens métier que pour ses ventes.
//
// Ne regarde que les écritures avec une ligne tiers identifiée ET déjà
// lettrée (une facture non lettrée ne nous dit rien sur "ce que ce client
// paie habituellement" — c'est justement l'inconnue qu'on essaie de lever
// pour d'autres écritures). Même limitation connue que analyserTauxHistorique
// : pas de détection des pièces multi-taux non éclatées avant calcul du
// taux implicite.
export function analyserTauxHistoriqueParTiers(
  ecritures: EcritureTvaComplete[],
  seuilOccurrences = 3
): PropositionTauxTiers[] {
  const histogrammeParTiers = new Map<string, Map<number, number>>();

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44571')) continue;

    const ligneTiers = ecriture.lignesTiers[0];
    if (!ligneTiers || !ligneTiers.lettrage.estLettree) continue;

    const baseHT = Math.abs(sommeNette(ecriture.autresLignes));
    if (baseHT === 0) continue;

    const montantTva = Math.abs(ecriture.ligneTva.credit - ecriture.ligneTva.debit);
    const tauxImplicite = normaliserTaux((montantTva / baseHT) * 100);

    const histogramme = histogrammeParTiers.get(ligneTiers.compte) ?? new Map<number, number>();
    histogramme.set(tauxImplicite, (histogramme.get(tauxImplicite) ?? 0) + 1);
    histogrammeParTiers.set(ligneTiers.compte, histogramme);
  }

  const propositions: PropositionTauxTiers[] = [];
  for (const [numeroCompteTiers, histogramme] of histogrammeParTiers) {
    const dominant = [...histogramme.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominant) continue;
    const [tauxDominant, count] = dominant;
    if (count < seuilOccurrences) continue;
    propositions.push({ numeroCompteTiers, tauxHabituel: tauxDominant, nbOccurrences: count });
  }

  return propositions;
}
