import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

const TAUX_OFFICIELS = [2.1, 5.5, 10, 20];

function normaliserTaux(valeur: number): number {
  for (const taux of TAUX_OFFICIELS) {
    if (Math.abs(valeur - taux) <= 0.5) return taux;
  }
  return Math.round(valeur * 10) / 10;
}

// Demande de Rami (10/08) — trouvé en creusant l'audit des contrôles :
// verifierCoherenceTauxCollecte et analyserTauxHistorique sont TOUS LES
// DEUX indexés sur le compte de TVA collectée lui-même (445711, 445712...),
// jamais sur le compte de PRODUIT (706100, 706200...). Ça fonctionne tant
// que le compte de TVA est déjà éclaté par taux — mais si le dossier
// utilise un compte 44571 générique pour toute la collecte, ces deux
// contrôles n'ont structurellement aucun moyen de savoir quel taux est
// attendu pour quel produit. Exemple donné par Rami : 706100 devrait
// toujours correspondre à un taux de 20%, 706200 à 10%, peu importe que le
// compte TVA en face soit lui-même éclaté ou non.
//
// Même principe exactement que verifierCoherenceTauxAutoliquidation
// (coherenceAutoliquidation.ts) : le taux "attendu" est le taux dominant
// observé pour CE compte produit précis sur la période — jamais une
// confirmation manuelle préalable (contrainte explicite de Rami : le
// contrôle doit savoir tourner sans qu'on lui dise le taux à l'avance).
//
// Gravité BLOQUANTE (demande explicite de Rami, malgré la nature
// statistique de la détection — décision assumée, pas une erreur de ma
// part) : contrairement à incoherence_taux_autoliquidation (signalée),
// celle-ci bloque.
//
// Chantier futur documenté (REGLES_FISCALES_ET_TACHES.md) : une fois le
// paramètre dossier "taux unique" construit, cette anomalie ne devra
// jamais se déclencher pour un dossier à taux unique confirmé (la question
// ne se pose pas). Pas encore appliqué ici — l'appelant (pipeline.ts)
// devra passer ce paramètre le jour où il existera.
export function verifierCoherenceTauxCollecteProduit(ecritures: EcritureTvaComplete[]): Anomalie[] {
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
        type: 'incoherence_taux_collecte_produit',
        gravite: 'bloquant',
        ledgerEntryId: l.ledgerEntryId,
        compte: l.compteProduit,
        description:
          `Taux implicite de ${l.tauxImplicite}% sur une écriture liée au compte produit ${l.compteProduit}, ` +
          `alors que le taux habituel observé pour ce compte cette période est ${tauxAttendu}%. Écart à ` +
          `vérifier (erreur de saisie possible, ou vente exceptionnelle à un autre taux).`,
        details: { tauxImplicite: l.tauxImplicite, tauxAttendu, libelle: l.libelle },
      });
    }
  }

  return anomalies;
}
