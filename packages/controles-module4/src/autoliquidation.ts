import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// Vérifie, pour chaque pièce, que la TVA due autoliquidée (compte "due") a
// bien sa contrepartie déductible (compte "déductible") avec un montant
// identique — et inversement. Les comptes sont une convention par dossier
// (Module 2 bis / conventions_dossier), jamais une constante universelle.
//
// Bug réel corrigé (10/08, trouvé par Rami) : cette fonction avait des
// valeurs par défaut codées en dur ('4454'/'445664') — sans confirmation
// explicite du dossier, elle tournait quand même dessus, en parallèle de
// compte_tva_non_reconnu qui bloque correctement tant que rien n'est
// confirmé. Un dossier n'ayant JAMAIS confirmé son compte d'autoliquidation
// pouvait donc voir surgir un faux positif de déséquilibre, basé sur une
// présomption jamais validée par personne. Retiré : plus aucune valeur par
// défaut, l'appelant doit fournir les deux comptes explicitement.
//
// Élargi (10/08, immo intracom, confirmé par Rami) : compteDeductible
// accepte désormais un seul compte OU une liste — nécessaire pour
// l'intracom, où le même compte dû (4452, confirmé identique que ce soit
// une immo ou un achat courant) peut avoir SA contrepartie déductible sur
// DEUX comptes différents selon la nature de l'acquisition (445662 pour un
// achat courant, 445622 pour une immobilisation). Chaque pièce cherche sa
// contrepartie parmi TOUS les comptes déductibles fournis — jamais un
// seul fixé d'avance, jamais les deux exigés simultanément sur la même
// pièce.
export function verifierAutoliquidationEquilibree(
  ecritures: EcritureTvaComplete[],
  compteDue: string,
  compteDeductible: string | string[],
  toleranceMontant = 0.01
): Anomalie[] {
  const anomalies: Anomalie[] = [];
  const comptesDeductibles = Array.isArray(compteDeductible) ? compteDeductible : [compteDeductible];
  const libelleComptesDeductibles = comptesDeductibles.join('/');

  const parPiece = new Map<number, EcritureTvaComplete[]>();
  for (const ecriture of ecritures) {
    if (ecriture.ligneTva.compte !== compteDue && !comptesDeductibles.includes(ecriture.ligneTva.compte)) {
      continue;
    }
    const liste = parPiece.get(ecriture.ledgerEntryId) ?? [];
    liste.push(ecriture);
    parPiece.set(ecriture.ledgerEntryId, liste);
  }

  for (const [ledgerEntryId, lignes] of parPiece) {
    const ligneDue = lignes.find((l) => l.ligneTva.compte === compteDue);
    // Premier compte déductible trouvé sur cette pièce — une pièce donnée
    // ne devrait matcher qu'un seul des comptes possibles (une acquisition
    // est soit une immo, soit un achat courant, jamais les deux à la fois
    // sur la même pièce).
    const ligneDeductible = lignes.find((l) => comptesDeductibles.includes(l.ligneTva.compte));
    const compteDeductibleTrouve = ligneDeductible?.ligneTva.compte ?? libelleComptesDeductibles;

    if (ligneDue && !ligneDeductible) {
      anomalies.push({
        type: 'autoliquidation_desequilibree',
        gravite: 'bloquant',
        ledgerEntryId,
        compte: compteDue,
        description: `TVA due autoliquidée (${compteDue}) sans contrepartie déductible (${libelleComptesDeductibles}) sur cette pièce — écriture d'autoliquidation probablement incomplète.`,
        details: { montantDue: montant(ligneDue) },
      });
      continue;
    }

    if (ligneDeductible && !ligneDue) {
      anomalies.push({
        type: 'autoliquidation_desequilibree',
        gravite: 'bloquant',
        ledgerEntryId,
        compte: compteDeductibleTrouve,
        description: `TVA déductible autoliquidée (${compteDeductibleTrouve}) sans contrepartie due (${compteDue}) sur cette pièce.`,
        details: { montantDeductible: montant(ligneDeductible) },
      });
      continue;
    }

    if (ligneDue && ligneDeductible) {
      const montantDue = montant(ligneDue);
      const montantDeductible = montant(ligneDeductible);
      if (Math.abs(montantDue - montantDeductible) > toleranceMontant) {
        anomalies.push({
          type: 'autoliquidation_desequilibree',
          gravite: 'bloquant',
          ledgerEntryId,
          compte: `${compteDue}/${compteDeductibleTrouve}`,
          description: `Montants d'autoliquidation différents entre ${compteDue} (${montantDue}) et ${compteDeductibleTrouve} (${montantDeductible}) sur la même pièce.`,
          details: { montantDue, montantDeductible },
        });
      }
    }
  }

  return anomalies;
}

function montant(ecriture: EcritureTvaComplete): number {
  return Math.abs(ecriture.ligneTva.credit - ecriture.ligneTva.debit);
}
