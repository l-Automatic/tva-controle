import type { EcritureTvaComplete } from '@tva-controle/core';

export interface CandidatJugementVehiculeTourisme {
  ledgerEntryId: number;
  libelle: string | null;
}

// Identifie les écritures d'achat d'immobilisation véhicule (compte 2182,
// matériel de transport) avec une TVA réellement DÉDUITE (44562 > 0) —
// candidat pour jugerLibellesVehiculeTourisme (connector-mistral), pas
// une détection en soi. Le libellé seul peut dire s'il s'agit d'un
// véhicule de tourisme (0% déductible) ou utilitaire (100%) — aucun
// moyen déterministe de le savoir depuis le seul numéro de compte.
//
// 10/08, refonte demandée par Rami : remplace l'ancien signalement
// systématique de toute ligne 44562 dès qu'un véhicule de tourisme
// existait quelque part dans le parc (bien trop large — signalait même
// des achats d'immobilisation totalement sans rapport, indéfiniment).
// Ici, uniquement la ligne 2182 précise de la période, ET seulement si
// de la TVA a réellement été déduite (si aucune TVA n'a été déduite,
// rien à corriger même si c'est un tourisme — pas de candidat).
export function identifierCandidatsJugementVehiculeTourisme(
  ecritures: EcritureTvaComplete[]
): CandidatJugementVehiculeTourisme[] {
  const candidats: CandidatJugementVehiculeTourisme[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44562')) continue;

    const montantDeduit = ecriture.ligneTva.debit;
    if (montantDeduit <= 0) continue; // rien de déduit, rien à corriger même si tourisme

    const touchesVehicule = ecriture.autresLignes.some((l) => l.compte.startsWith('2182'));
    if (!touchesVehicule) continue;

    candidats.push({ ledgerEntryId: ecriture.ligneTva.ledgerEntryId, libelle: ecriture.ligneTva.libelle });
  }

  return candidats;
}
