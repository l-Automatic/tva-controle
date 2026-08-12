import type { EcritureTvaComplete } from '@tva-controle/core';

export interface CompteSansTauxAssigne {
  compte: string;
  exemplesLibelle: string[];
}

// Symétrique de identifierComptesACategoriser, mais pour l'onglet Taux
// assigné plutôt que le popup de conventions : liste les comptes
// produit/charge mouvementés (classes 6/7 uniquement — le taux assigné n'a
// de sens ni sur un compte de trésorerie, ni sur un compte tiers) qui n'ont
// pas encore de taux_assigne_compte. Demande de Rami (09/08) : proposer un
// candidat plutôt que de forcer une saisie libre à chaque fois.
export function identifierComptesSansTauxAssigne(
  ecritures: EcritureTvaComplete[],
  comptesDejaAssignes: string[]
): CompteSansTauxAssigne[] {
  const dejaAssignes = new Set(comptesDejaAssignes);
  const libellesParCompte = new Map<string, Set<string>>();

  for (const ecriture of ecritures) {
    for (const ligne of ecriture.autresLignes) {
      if (dejaAssignes.has(ligne.compte) || !/^[67]/.test(ligne.compte)) continue;

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

export interface CompteClientSansTauxAssigne {
  numeroCompteTiers: string;
  nomTiers: string | null;
}

// Équivalent côté comptes clients — tiers mouvementés sans taux
// (historique OU assigné manuellement) déjà connu pour ce dossier.
export function identifierComptesClientSansTaux(
  ecritures: EcritureTvaComplete[],
  comptesClientDejaConnus: string[]
): CompteClientSansTauxAssigne[] {
  const dejaConnus = new Set(comptesClientDejaConnus);
  const parCompte = new Map<string, string | null>();

  for (const ecriture of ecritures) {
    for (const ligneTiers of ecriture.lignesTiers) {
      if (dejaConnus.has(ligneTiers.compte)) continue;
      if (!parCompte.has(ligneTiers.compte)) {
        parCompte.set(ligneTiers.compte, ligneTiers.libelleCompte);
      }
    }
  }

  return [...parCompte.entries()]
    .map(([numeroCompteTiers, nomTiers]) => ({ numeroCompteTiers, nomTiers }))
    .sort((a, b) => a.numeroCompteTiers.localeCompare(b.numeroCompteTiers));
}
