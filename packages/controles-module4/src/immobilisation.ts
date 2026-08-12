import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// Convention par compte, propre au dossier — aucun défaut national ne fait
// sens (chaque cabinet choisit ses comptes de petit équipement).
export interface ConfigImmobilisationManquee {
  comptesEquipement: string[]; // ex: ['6063']
  seuilHT?: number; // défaut 500 (€ HT, par ligne)
  // Pièces déjà vérifiées lors d'une CA3 antérieure — à ne pas re-signaler.
  referencesDejaVerifiees?: Set<number>;
}

// Décision finale toujours humaine ("ensemble fonctionnel ?" = cas par cas
// sur une facture, jamais automatisable) — d'où gravite 'signale' partout,
// jamais 'bloquant'.
export function detecterImmobilisationManquee(
  ecritures: EcritureTvaComplete[],
  config: ConfigImmobilisationManquee
): Anomalie[] {
  const seuil = config.seuilHT ?? 500;
  const dejaVerifiees = config.referencesDejaVerifiees ?? new Set<number>();
  const anomalies: Anomalie[] = [];

  const traitees = new Set<number>();

  for (const ecriture of ecritures) {
    const { ledgerEntryId } = ecriture.ligneTva;
    if (traitees.has(ledgerEntryId) || dejaVerifiees.has(ledgerEntryId)) continue;

    const lignesConcernees = ecriture.autresLignes.filter(
      (l) =>
        config.comptesEquipement.some((prefixe) => l.compte.startsWith(prefixe)) &&
        Math.abs(l.debit - l.credit) > seuil
    );

    if (lignesConcernees.length === 0) continue;

    traitees.add(ledgerEntryId);
    anomalies.push({
      type: 'immobilisation_potentielle_non_passee',
      gravite: 'signale',
      ledgerEntryId,
      compte: lignesConcernees.map((l) => l.compte).join(', '),
      description:
        lignesConcernees.length === 1
          ? `Achat de ${Math.abs(lignesConcernees[0]!.debit - lignesConcernees[0]!.credit).toFixed(2)}€ HT sur un compte de petit équipement, au-delà du seuil de ${seuil}€ : à vérifier pour passage en immobilisation.`
          : `${lignesConcernees.length} lignes de petit équipement dépassant individuellement ${seuil}€ HT sur la même pièce : à vérifier pour passage en immobilisation (isolément ou comme ensemble fonctionnel).`,
      details: {
        seuil,
        lignes: lignesConcernees.map((l) => ({
          compte: l.compte,
          montant: Math.abs(l.debit - l.credit),
          libelle: l.libelle,
        })),
      },
    });
  }

  return anomalies;
}
