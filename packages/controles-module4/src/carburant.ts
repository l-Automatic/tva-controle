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
      });
      statuts.push({
        ledgerEntryId,
        compte: ligneCarburant.compte,
        tauxDeductible: null,
        motif: 'Parc de véhicules non renseigné.',
      });
      continue;
    }

    if (typesPresents.size > 1) {
      anomalies.push({
        type: 'flotte_mixte_carburant',
        gravite: 'signale',
        ledgerEntryId,
        compte: ligneCarburant.compte,
        description:
          'Flotte mixte (véhicules de tourisme ET utilitaires) : impossible de déterminer automatiquement à quel véhicule ce carburant se rapporte. Décision humaine requise.',
      });
      statuts.push({
        ledgerEntryId,
        compte: ligneCarburant.compte,
        tauxDeductible: null,
        motif: 'Flotte mixte : à déterminer manuellement.',
      });
      continue;
    }

    const seulType = [...typesPresents][0];
    const tauxDeductible = seulType === 'vehicule_utilitaire' ? 100 : 80;

    statuts.push({
      ledgerEntryId,
      compte: ligneCarburant.compte,
      tauxDeductible,
      motif: `Flotte homogène (${seulType === 'vehicule_utilitaire' ? 'utilitaire' : 'tourisme'}) -> ${tauxDeductible}% déductible.`,
    });
  }

  return { statuts, anomalies };
}
