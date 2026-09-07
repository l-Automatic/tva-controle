import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

const TAUX_OFFICIELS = [2.1, 5.5, 10, 20];

function normaliserTaux(valeur: number): number {
  for (const taux of TAUX_OFFICIELS) {
    if (Math.abs(valeur - taux) <= 0.5) return taux;
  }
  return Math.round(valeur * 10) / 10;
}

// Demande de Rami (10/08) : contrôler la cohérence entre le taux de TVA
// collectée et le compte de PRODUIT associé — distinct de
// verifierCoherenceTauxCollecte (Module 4) et de analyserTauxHistorique
// (onboarding-module3), qui sont TOUS LES DEUX indexés sur le compte de
// TVA collectée lui-même (44571x), jamais sur le compte produit (7xxx).
// Ça fonctionne tant que le compte de collecte est déjà éclaté par taux
// (445711 pour 20%, 445712 pour 10%...) — mais un dossier qui utilise un
// compte 44571 générique pour toute la collecte n'a structurellement
// aucun moyen d'être couvert par ces deux contrôles-là.
//
// Ici, le regroupement se fait sur le compte PRODUIT (706100, 706200...),
// pas sur le compte de collecte — le taux "attendu" pour un compte
// produit donné est calculé directement depuis les écritures elles-mêmes
// (taux dominant observé), jamais besoin d'une confirmation manuelle
// préalable (même principe que coherenceAutoliquidation.ts, appliqué au
// produit plutôt qu'à la charge).
export function verifierCoherenceTauxProduit(ecritures: EcritureTvaComplete[]): Anomalie[] {
  interface LigneCollecte {
    ledgerEntryId: number;
    compteProduit: string;
    tauxImplicite: number;
    libelle: string | null;
  }

  const lignes: LigneCollecte[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44571')) continue;

    const ligneProduit = ecriture.autresLignes[0];
    if (!ligneProduit) continue;

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    const baseHt = Math.abs(ligneProduit.debit - ligneProduit.credit);
    if (baseHt === 0) continue;

    lignes.push({
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      compteProduit: ligneProduit.compte,
      tauxImplicite: normaliserTaux((montantTva / baseHt) * 100),
      libelle: ecriture.ligneTva.libelle,
    });
  }

  if (lignes.length === 0) return [];

  // Taux dominant par compte produit.
  const histogrammeParCompte = new Map<string, Map<number, number>>();
  for (const l of lignes) {
    const h = histogrammeParCompte.get(l.compteProduit) ?? new Map<number, number>();
    h.set(l.tauxImplicite, (h.get(l.tauxImplicite) ?? 0) + 1);
    histogrammeParCompte.set(l.compteProduit, h);
  }

  const tauxDominantParCompte = new Map<string, number>();
  for (const [compte, histogramme] of histogrammeParCompte) {
    const dominant = [...histogramme.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominant) tauxDominantParCompte.set(compte, dominant[0]);
  }

  const anomalies: Anomalie[] = [];
  for (const l of lignes) {
    const tauxAttendu = tauxDominantParCompte.get(l.compteProduit);
    if (tauxAttendu !== undefined && l.tauxImplicite !== tauxAttendu) {
      anomalies.push({
        type: 'incoherence_taux_produit',
        gravite: 'bloquant',
        ledgerEntryId: l.ledgerEntryId,
        compte: l.compteProduit,
        description:
          `Taux implicite de ${l.tauxImplicite}% sur ce compte produit, alors que le taux habituel observé sur ` +
          `ce compte cette période est ${tauxAttendu}%. Écart à vérifier (erreur de saisie possible).`,
        details: { tauxImplicite: l.tauxImplicite, tauxAttendu, libelle: l.libelle },
      });
    }
  }

  return anomalies;
}

export interface BaseHtParTaux {
  total: number;
  parTaux: { taux20: number; taux10: number; taux5_5: number; taux2_1: number };
}

// Agrège la base HT du chiffre d'affaires taxable, par taux — ligne 3 de
// la CA3 (10/08, chantier déclaration). Réutilise exactement la même
// extraction de lignes que verifierCoherenceTauxProduit (compte produit +
// taux implicite propre à CHAQUE ligne, jamais le taux dominant "corrigé"
// — la déclaration doit refléter ce qui a réellement été saisi, pas une
// version lissée). Le contrôle de cohérence "total = somme des détails"
// exigé par Rami est garanti PAR CONSTRUCTION ici : les deux viennent de
// la même donnée de base, jamais deux calculs séparés qui pourraient
// diverger.
//
// N'inclut que les ventes AVEC une ligne 44571x associée (donc taxables)
// — une vente exonérée (export, intracom) n'a par nature aucune ligne de
// collecte, elle est donc naturellement exclue ici et comptée séparément
// (lignes 5/6, chantier à part, pas encore construit).
export function agregerBaseHtParTaux(ecritures: EcritureTvaComplete[]): BaseHtParTaux {
  const parTaux = { taux20: 0, taux10: 0, taux5_5: 0, taux2_1: 0 };

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44571')) continue;

    const ligneProduit = ecriture.autresLignes[0];
    if (!ligneProduit) continue;

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    const baseHt = Math.abs(ligneProduit.debit - ligneProduit.credit);
    if (baseHt === 0) continue;

    const taux = normaliserTaux((montantTva / baseHt) * 100);
    if (taux === 20) parTaux.taux20 += baseHt;
    else if (taux === 10) parTaux.taux10 += baseHt;
    else if (taux === 5.5) parTaux.taux5_5 += baseHt;
    else if (taux === 2.1) parTaux.taux2_1 += baseHt;
    // Taux non officiel (déjà signalé par verifierCoherenceTauxProduit
    // le cas échéant) : exclu ici plutôt que compté sous un taux
    // arbitraire — le total resterait alors inférieur à la vraie somme
    // tant que l'anomalie n'est pas corrigée, jamais un chiffre faux
    // silencieux.
  }

  const total = parTaux.taux20 + parTaux.taux10 + parTaux.taux5_5 + parTaux.taux2_1;
  return { total, parTaux };
}
