import type { LigneEcritureAvecLettrage, Anomalie } from '@tva-controle/core';

// Un compte d'attente (471 en pratique, configurable par dossier) reçoit de
// l'argent dont on ne sait pas encore, comptablement, à quoi il correspond.
// Tant que la ligne n'est pas lettrée (rapprochée avec autre chose côté
// Pennylane), c'est un encaissement non identifié : peut-être une vente (et
// alors de la TVA est due, à un taux qu'on ne connaît pas automatiquement),
// peut-être totalement hors TVA (remboursement d'assurance, remboursement
// d'impôts...). Distinguer les deux nécessiterait de juger sur le libellé
// de l'opération — hors de portée d'un contrôle déterministe, prévu comme
// tâche Module 5 (LLM, non construit à ce stade). En attendant, systématique
// : toute ligne créditrice non lettrée remonte pour qualification humaine.
//
// Bloquant, volontairement : ignorer un encaissement non identifié revient
// à risquer de la TVA collectée mais jamais déclarée — le même niveau de
// gravité qu'un compte TVA non reconnu (comptesNonReconnus.ts).
export function detecterEncaissementsNonAffectes(lignes: LigneEcritureAvecLettrage[]): Anomalie[] {
  return lignes
    .filter((l) => l.credit > 0 && !l.lettrage.estLettree)
    .map((l) => ({
      type: 'encaissement_non_affecte',
      gravite: 'bloquant',
      ledgerEntryId: l.ledgerEntryId,
      compte: l.compte,
      description:
        `Encaissement de ${l.credit.toFixed(2)} € TTC sur le compte ${l.compte}, non identifié. ` +
        `À qualifier manuellement : lié à une vente (taux de TVA à préciser) ou sans lien avec ` +
        `une vente (remboursement, régularisation...).`,
      details: { montantTTC: l.credit, libelle: l.libelle, date: l.date },
    }));
}
