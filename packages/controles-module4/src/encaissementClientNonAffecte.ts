import type { LigneEcritureAvecLettrage, Anomalie, ContexteDossier } from '@tva-controle/core';
import { tauxHabituelPour } from '@tva-controle/core';

export interface RegularisationClientAAppliquer {
  ledgerEntryId: number;
  compte: string;
  montantTTC: number;
  taux: number;
  source: 'taux_historique' | 'defaut_prudence_20';
}

export type RegimeTvaEncaissement = 'service' | 'bien' | 'mixte';

const TAUX_PRUDENCE_PAR_DEFAUT = 20;

// Chantier B : par prudence fiscale (le droit de collecter appartient à
// l'État), un encaissement client non lettré doit générer de la TVA
// collectée même sans facture rapprochée — contrairement au compte
// d'attente 471 (encaissementNonAffecte.ts), qui bloque et attend une
// qualification humaine avant toute inclusion, ici on applique un taux par
// défaut DIRECTEMENT, sans bloquer.
//
// Mais ATTENTION (correction du 09/08, vrai bug trouvé après relecture de
// la conversation d'origine) : cette règle n'est valable QUE pour un
// encaissement lié à une prestation de SERVICE. Sur un bien, un acompte
// n'ouvre AUCUN droit à collecte (art. 269-2-a CGI) — la TVA sur bien est
// exigible à la facturation/livraison, jamais à l'encaissement. Appliquer
// 20% par défaut sur un acompte de bien serait une sur-collecte à tort.
//
// D'où regimeTvaEncaissement, paramètre dossier (paramétré une fois,
// jamais déduit automatiquement) :
//   - 'service' : le dossier ne vend (quasi) que des prestations -> la
//     règle ci-dessous s'applique normalement (comportement historique).
//   - 'bien' : le dossier vend des biens (ou encaisse comptant, ex: un
//     commerce avec caisse — payé tout de suite, donc immédiatement
//     collectable de toute façon, bien ou service) -> AUCUNE régularisation
//     ici, un encaissement non lettré sur ce type de dossier ne doit rien
//     déclencher automatiquement.
//   - 'mixte' : on ne peut pas savoir sans info supplémentaire si tel
//     encaissement précis se rapporte à un bien ou un service -> on garde
//     le comportement prudent actuel (20% par défaut), comme avant ce fix.
//
// Bug réel corrigé (10/08, trouvé par Rami sur une vraie capture) : un
// AVOIR CLIENT se traduit lui aussi par un crédit non lettré sur un compte
// 411 — exactement le même signal comptable brut qu'un vrai encaissement.
// Sans distinction, un avoir se faisait traiter à tort comme "de l'argent
// est arrivé", collectant de la TVA sur une ligne qui en réalité RÉDUIT ce
// qui est dû, jamais l'inverse — une vraie sur-collecte. Corrigé via le
// journal de la pièce : tout ce qui est dans le journal de vente confirmé
// fait partie du flux de facturation normal (facture ou avoir), jamais un
// vrai encaissement — exclu ici. Tout le reste (banque, caisse...) est un
// vrai encaissement, comportement inchangé. journalCodeParId peut être un
// Map vide (résolution non disponible) : dans ce cas, aucune ligne n'est
// filtrée par journal, comportement identique à avant ce correctif — pas
// de régression si la résolution échoue, juste pas de protection.
export function detecterEncaissementsClientAAffecter(
  lignes: LigneEcritureAvecLettrage[],
  contexteDossier: ContexteDossier,
  regimeTvaEncaissement: RegimeTvaEncaissement = 'service',
  journalCodeVente?: string,
  journalCodeParId: Map<number, string> = new Map()
): { regularisations: RegularisationClientAAppliquer[]; anomalies: Anomalie[] } {
  if (regimeTvaEncaissement === 'bien') {
    return { regularisations: [], anomalies: [] };
  }

  const regularisations: RegularisationClientAAppliquer[] = [];
  const anomalies: Anomalie[] = [];

  for (const ligne of lignes) {
    if (ligne.credit <= 0 || ligne.lettrage.estLettree) continue;

    // Avoir client (dans le journal de vente) : jamais un encaissement,
    // exclu avant même de calculer un taux — cf. commentaire ci-dessus.
    if (journalCodeVente && ligne.journalId !== undefined) {
      const codeReel = journalCodeParId.get(ligne.journalId);
      if (codeReel === journalCodeVente) continue;
    }

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
        `(aucune facture rapprochée). TVA collectée appliquée au taux de ${taux}% ` +
        `(${source === 'taux_historique' ? 'taux habituel connu de ce client' : 'défaut de prudence, taux du client inconnu ou mixte'}). ` +
        `Modifiable si vous disposez d'une information contraire (acompte à un autre taux, etc.).`,
      details: { montantTTC: ligne.credit, libelle: ligne.libelle, date: ligne.date, tauxApplique: taux, source },
    });
  }

  return { regularisations, anomalies };
}
