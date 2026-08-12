import type { EcritureTvaComplete } from '@tva-controle/core';

export interface ComptesConnus {
  comptesVenteService: string[];
  comptesChargeService: string[];
  comptesEquipement: string[];
  comptesCarburant: string[];
  comptesCadeaux?: string[];
  comptesImmobilisation?: string[];
}

export interface CompteACategoriser {
  compte: string;
  exemplesLibelle: string[]; // jusqu'à 3 libellés vus, pour aider à catégoriser sans ouvrir Pennylane
}

// Détection déterministe pour le popup de catégorisation demandé par Rami
// (08/08) : plutôt que de saisir un à un les comptes à ranger dans les 4
// conventions, présenter d'un coup tous les comptes produit/charge
// réellement mouvementés sur la période qui ne sont dans AUCUNE des 4
// listes déjà configurées — le collaborateur n'a plus qu'à choisir une
// catégorie (ou "aucune de celles-là") pour chacun, au lieu de deviner
// quels comptes existent.
//
// Volontairement SANS présélection automatique ici : une présélection par
// IA (Mistral) est prévue en amont de ce popup mais dépend d'un chantier
// pas encore construit (aucun appel LLM réel dans le projet à ce stade) —
// cette fonction ne fait que la détection déterministe, la présélection
// viendra se greffer dessus séparément.
export function identifierComptesACategoriser(
  ecritures: EcritureTvaComplete[],
  connus: ComptesConnus
): CompteACategoriser[] {
  const tousPrefixesConnus = [
    ...connus.comptesVenteService,
    ...connus.comptesChargeService,
    ...connus.comptesEquipement,
    ...connus.comptesCarburant,
    ...(connus.comptesCadeaux ?? []),
    ...(connus.comptesImmobilisation ?? []),
  ];
  // Comparaison par préfixe, cohérente avec exigibilite.ts/carburant.ts/
  // immobilisation.ts : les conventions contiennent des préfixes ('706'),
  // pas forcément des numéros de compte exacts ('706100' doit compter comme
  // déjà catégorisé si '706' est déjà dans une convention).
  const estDejaConnu = (compte: string) => tousPrefixesConnus.some((prefixe) => compte.startsWith(prefixe));

  // Filtre par classe de compte (PCG) : seules les charges (6), produits (7)
  // et immobilisations (2) ont un sens pour ce popup. Bug réel trouvé le
  // 08/08 : sans ce filtre, un compte de trésorerie (5121, banque) apparu
  // par erreur dans autresLignes se retrouvait proposé à la catégorisation
  // alors que la question ne se pose même pas pour ce type de compte.
  const estClassePertinente = (compte: string) => /^[267]/.test(compte);

  const libellesParCompte = new Map<string, Set<string>>();

  for (const ecriture of ecritures) {
    for (const ligne of ecriture.autresLignes) {
      if (estDejaConnu(ligne.compte) || !estClassePertinente(ligne.compte)) continue;

      const libelles = libellesParCompte.get(ligne.compte) ?? new Set<string>();
      if (ligne.libelle && libelles.size < 3) {
        libelles.add(ligne.libelle);
      }
      libellesParCompte.set(ligne.compte, libelles);
    }
  }

  return [...libellesParCompte.entries()]
    .map(([compte, libelles]) => ({ compte, exemplesLibelle: [...libelles] }))
    .sort((a, b) => a.compte.localeCompare(b.compte));
}
