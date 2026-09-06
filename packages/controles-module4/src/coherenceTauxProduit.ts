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
