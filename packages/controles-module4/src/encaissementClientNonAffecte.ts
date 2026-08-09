import type { LigneEcritureAvecLettrage, Anomalie, ContexteDossier } from '@tva-controle/core';
import { tauxHabituelPour } from '@tva-controle/core';

export interface RegularisationClientAAppliquer {
  ledgerEntryId: number;
  compte: string;
  montantTTC: number;
  taux: number;
  source: 'taux_historique' | 'defaut_prudence_20';
}

const TAUX_PRUDENCE_PAR_DEFAUT = 20;

// Chantier B : par prudence fiscale (le droit de collecter appartient à
// l'État), un encaissement client non lettré doit générer de la TVA
// collectée même sans facture rapprochée — contrairement au compte
// d'attente 471 (encaissementNonAffecte.ts), qui bloque et attend une
// qualification humaine avant toute inclusion, ici on applique un taux par
// défaut DIRECTEMENT, sans bloquer :
//   - taux historique confirmé et mono-taux pour ce compte client -> ce taux
//   - sinon (compte mixte ou jamais vu) -> 20%, le taux le plus élevé
//
// Une anomalie 'signale' (jamais bloquante) trace systématiquement la
// décision prise, pour que le collaborateur puisse la corriger s'il a une
// information contraire (ex : il sait que c'est un acompte à 10%) — voir
// qualifierEncaissementClient côté orchestrateur pour la correction.
export function detecterEncaissementsClientAAffecter(
  lignes: LigneEcritureAvecLettrage[],
  contexteDossier: ContexteDossier
): { regularisations: RegularisationClientAAppliquer[]; anomalies: Anomalie[] } {
  const regularisations: RegularisationClientAAppliquer[] = [];
  const anomalies: Anomalie[] = [];

  for (const ligne of lignes) {
    if (ligne.credit <= 0 || ligne.lettrage.estLettree) continue;

    const tauxConnu = tauxHabituelPour(contexteDossier, ligne.compte);
    const taux = tauxConnu ?? TAUX_PRUDENCE_PAR_DEFAUT;
    const source: RegularisationClientAAppliquer['source'] =
      tauxConnu !== null ? 'taux_historique' : 'defaut_prudence_20';

    regularisations.push({
      ledgerEntryId: ligne.ledgerEntryId,
      compte: ligne.compte,
      montantTTC: ligne.credit,
      taux,
      source,
    });

    anomalies.push({
      type: 'encaissement_client_taux_applique',
      gravite: 'signale',
      ledgerEntryId: ligne.ledgerEntryId,
      compte: ligne.compte,
      description:
        `Encaissement de ${ligne.credit.toFixed(2)} € TTC sur le compte ${ligne.compte}, non lettré ` +
        `(aucune facture rapprochée) — TVA collectée appliquée au taux de ${taux}% ` +
        `(${source === 'taux_historique' ? 'taux habituel connu de ce client' : 'défaut de prudence, taux du client inconnu ou mixte'}). ` +
        `Modifiable si vous disposez d'une information contraire (acompte à un autre taux, etc.).`,
      details: { montantTTC: ligne.credit, libelle: ligne.libelle, date: ligne.date, tauxApplique: taux, source },
    });
  }

  return { regularisations, anomalies };
}
