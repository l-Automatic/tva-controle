import type { EcritureTvaComplete, Anomalie, ContexteDossier } from '@tva-controle/core';
import { tauxHabituelPour } from '@tva-controle/core';
import { TAUX_NOMINAL_PAR_DEFAUT } from './types.js';

// Calcule le taux implicite HT/TVA d'une écriture et le compare au taux
// attendu pour le sous-compte utilisé. Volontairement arithmétique, pas basé
// sur le libellé du compte (décision prise après retour d'expérience : le
// libellé n'est quasiment jamais fiable côté saisie, le montant si).
//
// Source du taux attendu, par ordre de priorité :
//   1. Le dossier a déjà un taux habituel connu pour ce compte (taux_historique,
//      via contexteDossier) -> on compare CONTRE CETTE VALEUR, pas contre une
//      constante nationale. Un dossier n'utilisant historiquement que 3 des 4
//      taux officiels ne doit pas être jugé contre le 4e qu'il n'a jamais eu.
//   2. Sinon (compte encore inconnu du dossier) -> repli sur le taux nominal
//      national (tauxNominalParCompte, défaut TAUX_NOMINAL_PAR_DEFAUT), en
//      filet de sécurité minimal.
//
// Garde-fou : si une même pièce touche plusieurs sous-comptes de taux
// différents (facture multi-taux non éclatée en écriture), on n'essaie PAS
// de calculer un taux implicite qui n'aurait pas de sens — on escalade pour
// vérification manuelle à la place. Décision explicite prise en amont :
// mieux vaut escalader que conclure sur une base ambiguë.
export function verifierCoherenceTauxCollecte(
  ecritures: EcritureTvaComplete[],
  tauxNominalParCompte: Record<string, number> = TAUX_NOMINAL_PAR_DEFAUT,
  toleranceAbsoluePoints = 0.5,
  contexteDossier?: ContexteDossier
): Anomalie[] {
  const anomalies: Anomalie[] = [];

  const comptesConcernes = new Set(Object.keys(tauxNominalParCompte));

  // Compte, par pièce, combien de sous-comptes à taux nominal distincts sont touchés
  const comptesTauxParPiece = new Map<number, Set<string>>();
  for (const ecriture of ecritures) {
    if (!comptesConcernes.has(ecriture.ligneTva.compte)) continue;
    const set = comptesTauxParPiece.get(ecriture.ledgerEntryId) ?? new Set<string>();
    set.add(ecriture.ligneTva.compte);
    comptesTauxParPiece.set(ecriture.ledgerEntryId, set);
  }

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId } = ecriture.ligneTva;
    if (!comptesConcernes.has(compte)) continue;

    const nbTauxDansPiece = comptesTauxParPiece.get(ledgerEntryId)?.size ?? 1;
    if (nbTauxDansPiece > 1) {
      anomalies.push({
        type: 'taux_multi_non_eclate',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description:
          'Pièce touchant plusieurs sous-comptes de taux TVA distincts — vérification manuelle nécessaire, taux implicite non calculé automatiquement.',
      });
      continue;
    }

    const baseHT = Math.abs(sommeNette(ecriture.autresLignes.map((l) => ({ debit: l.debit, credit: l.credit }))));
    const montantTva = Math.abs(sommeNette([{ debit: ecriture.ligneTva.debit, credit: ecriture.ligneTva.credit }]));

    if (baseHT === 0) {
      anomalies.push({
        type: 'base_ht_nulle',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: 'Base HT nulle ou introuvable sur la pièce — taux implicite non vérifiable.',
      });
      continue;
    }

    const tauxDossier = contexteDossier ? tauxHabituelPour(contexteDossier, compte) : null;
    const tauxAttendu = tauxDossier ?? (tauxNominalParCompte[compte] as number);
    const sourceTaux = tauxDossier !== null ? 'convention_dossier' : 'taux_national_par_defaut';

    const tauxImplicite = (montantTva / baseHT) * 100;

    if (Math.abs(tauxImplicite - tauxAttendu) > toleranceAbsoluePoints) {
      anomalies.push({
        type: 'taux_incoherent',
        gravite: 'bloquant',
        ledgerEntryId,
        compte,
        description: `Taux implicite calculé (${tauxImplicite.toFixed(2)}%) incohérent avec le taux attendu du compte ${compte} (${tauxAttendu}%, source : ${sourceTaux}).`,
        details: { tauxImplicite, tauxAttendu, sourceTaux, baseHT, montantTva },
      });
    }
  }

  return anomalies;
}

function sommeNette(lignes: Array<{ debit: number; credit: number }>): number {
  return lignes.reduce((acc, l) => acc + (l.credit - l.debit), 0);
}
