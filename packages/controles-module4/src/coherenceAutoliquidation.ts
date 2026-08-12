import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

export interface ConfigCoherenceAutoliquidation {
  compteTvaDeductibleAutoliquidee: string; // ex: '445664'
}

const TAUX_OFFICIELS = [2.1, 5.5, 10, 20];

function normaliserTaux(valeur: number): number {
  for (const taux of TAUX_OFFICIELS) {
    if (Math.abs(valeur - taux) <= 0.5) return taux;
  }
  return Math.round(valeur * 10) / 10;
}

// Demande de Rami (09/08) : contrôler la cohérence HT/TVA sur le compte de
// charge spécifiquement identifié comme lié à l'autoliquidation (ex: un
// dossier peut avoir DEUX sous-comptes 604 — un pour les achats classiques,
// un pour les achats autoliquidés — seul le second est concerné ici).
// Distinct de la limitation de analyserTauxHistorique (44566 exclu car
// souvent mixte) : le compte de charge spécifique à l'autoliquidation a
// typiquement un taux stable, donc la cohérence a du sens dessus,
// contrairement au compte 44566 générique.
//
// Identification du compte de charge concerné : par co-occurrence sur la
// même pièce que la ligne de TVA déductible autoliquidée confirmée (même
// technique que identifierFournisseursService) — pas une convention
// séparée à saisir, déduit directement des écritures de la période.
//
// Le taux "attendu" est calculé ICI, sur les écritures de la période
// elle-même (taux dominant observé), pas depuis un taux historique
// persisté séparément — plus simple, suffisant pour détecter une
// incohérence flagrante (retour d'expérience : l'écart entre deux taux
// officiels est "flagrant", jamais une nuance à trancher finement).
export function verifierCoherenceTauxAutoliquidation(
  ecritures: EcritureTvaComplete[],
  config: ConfigCoherenceAutoliquidation
): Anomalie[] {
  interface LigneAutoliq {
    ledgerEntryId: number;
    compteCharge: string;
    tauxImplicite: number;
    libelle: string | null;
  }

  const lignes: LigneAutoliq[] = [];

  for (const ecriture of ecritures) {
    if (ecriture.ligneTva.compte !== config.compteTvaDeductibleAutoliquidee) continue;

    const ligneCharge = ecriture.autresLignes[0];
    if (!ligneCharge) continue;

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    const baseHt = Math.abs(ligneCharge.debit - ligneCharge.credit);
    if (baseHt === 0) continue;

    lignes.push({
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      compteCharge: ligneCharge.compte,
      tauxImplicite: normaliserTaux((montantTva / baseHt) * 100),
      libelle: ecriture.ligneTva.libelle,
    });
  }

  if (lignes.length === 0) return [];

  // Taux dominant par compte de charge concerné.
  const histogrammeParCompte = new Map<string, Map<number, number>>();
  for (const l of lignes) {
    const h = histogrammeParCompte.get(l.compteCharge) ?? new Map<number, number>();
    h.set(l.tauxImplicite, (h.get(l.tauxImplicite) ?? 0) + 1);
    histogrammeParCompte.set(l.compteCharge, h);
  }

  const tauxDominantParCompte = new Map<string, number>();
  for (const [compte, histogramme] of histogrammeParCompte) {
    const dominant = [...histogramme.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominant) tauxDominantParCompte.set(compte, dominant[0]);
  }

  const anomalies: Anomalie[] = [];
  for (const l of lignes) {
    const tauxAttendu = tauxDominantParCompte.get(l.compteCharge);
    if (tauxAttendu !== undefined && l.tauxImplicite !== tauxAttendu) {
      anomalies.push({
        type: 'incoherence_taux_autoliquidation',
        gravite: 'signale',
        ledgerEntryId: l.ledgerEntryId,
        compte: l.compteCharge,
        description:
          `Taux implicite de ${l.tauxImplicite}% sur ce compte d'autoliquidation, alors que le taux habituel ` +
          `observé sur ce compte cette période est ${tauxAttendu}%. Écart à vérifier (erreur de saisie possible).`,
        details: { tauxImplicite: l.tauxImplicite, tauxAttendu, libelle: l.libelle },
      });
    }
  }

  return anomalies;
}
