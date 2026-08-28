import type { EcritureTvaComplete, Anomalie, ContexteDossier } from '@tva-controle/core';

// Convention par compte, propre au dossier.
export interface ConfigCarburantVehicule {
  comptesCarburant: string[]; // ex: ['6061']
}

export interface StatutCarburant {
  ledgerEntryId: number;
  compte: string;
  tauxDeductible: number | null; // null = indéterminable, décision humaine requise
  motif: string;
}

// Règle retenue : 100% déductible si la flotte du dossier est homogène
// utilitaire, 80% si homogène tourisme. Flotte mixte ou parc non renseigné =
// indéterminable automatiquement -> on flague, on ne tranche jamais seul
// (décision actée : la décision revient à un humain, le contrôle se contente
// de signaler).
export function determinerDeductibiliteCarburant(
  ecritures: EcritureTvaComplete[],
  config: ConfigCarburantVehicule,
  contexteDossier: ContexteDossier
): { statuts: StatutCarburant[]; anomalies: Anomalie[] } {
  const statuts: StatutCarburant[] = [];
  const anomalies: Anomalie[] = [];

  const typesPresents = new Set(
    contexteDossier.parcVehicules.map((v) => v.type).filter((t) => t !== 'autre')
  );

  for (const ecriture of ecritures) {
    const { ledgerEntryId } = ecriture.ligneTva;
    const ligneCarburant = ecriture.autresLignes.find((l) =>
      config.comptesCarburant.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (!ligneCarburant) continue;

    if (typesPresents.size === 0) {
      anomalies.push({
        type: 'parc_vehicules_non_renseigne',
        gravite: 'signale',
        ledgerEntryId,
        compte: ligneCarburant.compte,
        description:
          'Achat de carburant sans aucun véhicule répertorié dans le dossier : déductibilité (80%/100%) non déterminable automatiquement.',
        details: { libelle: ligneCarburant.libelle },
      });
      statuts.push({
        ledgerEntryId,
        compte: ligneCarburant.compte,
        tauxDeductible: null,
        motif: 'Parc de véhicules non renseigné.',
      });
      continue;
    }

    // Flotte mixte (10/08, retiré après discussion avec Rami) : en pratique,
    // ce cas n'arrive quasiment jamais — un dossier qui a déjà un
    // utilitaire (100% déductible) n'a aucun intérêt à immobiliser un
    // véhicule de tourisme en plus, puisque ça compromettrait sa
    // déduction déjà acquise. Décision explicite si ça arrive quand même :
    // déduire normalement à 100%, jamais de réduction spéciale ni de
    // signalement — à revoir si l'hypothèse se révèle fausse en pratique.
    const tauxDeductible = typesPresents.has('vehicule_tourisme') && typesPresents.size === 1 ? 80 : 100;

    statuts.push({
      ledgerEntryId,
      compte: ligneCarburant.compte,
      tauxDeductible,
      motif:
        typesPresents.size > 1
          ? `Flotte mixte (rare en pratique) -> ${tauxDeductible}% déductible, pas de réduction spéciale.`
          : `Flotte homogène (${[...typesPresents][0] === 'vehicule_utilitaire' ? 'utilitaire' : 'tourisme'}) -> ${tauxDeductible}% déductible.`,
    });
  }

  return { statuts, anomalies };
}
