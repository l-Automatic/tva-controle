import type { EcritureTvaComplete } from '@tva-controle/core';

export interface CandidatJugementFraisVehicule {
  ledgerEntryId: number;
  libelle: string | null;
  compte: string;
}

// Identifie les écritures d'entretien/réparation OU de location/crédit-bail
// de véhicule (compte confirmé, via comptesEntretienVehicule ou
// comptesLocationVehicule) avec une TVA réellement DÉDUITE — candidat pour
// jugerVehiculeIdentifieDansLibelle (connector-mistral), pas une détection
// en soi. Le libellé seul peut dire quel véhicule précis est concerné —
// aucun moyen déterministe de le savoir depuis le seul numéro de compte
// (10/08, demande de Rami).
//
// Ne s'applique QUE sur une flotte 100% tourisme (0% déductible dans tous
// les cas pour ces deux familles de charge, que le véhicule soit détenu en
// pleine propriété ou loué) — jamais sur une flotte mixte, où on ne peut
// pas deviner à quel véhicule précis (tourisme ou utilitaire) une facture
// se rapporte sans plus d'info. L'appelant (pipeline.ts) doit garantir
// cette condition avant d'appeler cette fonction, jamais vérifiée ici.
export function identifierCandidatsFraisVehicule(
  ecritures: EcritureTvaComplete[],
  comptesConcernes: string[]
): CandidatJugementFraisVehicule[] {
  const candidats: CandidatJugementFraisVehicule[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const montantDeduit = ecriture.ligneTva.debit;
    if (montantDeduit <= 0) continue; // rien de déduit, rien à corriger

    const ligneFrais = ecriture.autresLignes.find((l) => comptesConcernes.some((prefixe) => l.compte.startsWith(prefixe)));
    if (!ligneFrais) continue;

    candidats.push({
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      libelle: ecriture.ligneTva.libelle,
      compte: ligneFrais.compte,
    });
  }

  return candidats;
}
