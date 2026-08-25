import type { EcritureTvaComplete } from '@tva-controle/core';

export interface CandidatJugementHotel {
  ledgerEntryId: number;
  libelle: string | null;
}

// Complémentaire de verifierCoherenceTvaHotel (déterministe, sur le nom du
// compte fournisseur) : ici on identifie les écritures déductibles avec
// TVA que ce contrôle-là NE PEUT PAS couvrir — un fournisseur générique
// ("fournisseurs divers") dont le nom de compte ne mentionne pas "hôtel".
// Pour celles-ci, seul le libellé de l'écriture (le nom précis de l'hôtel,
// ex: "IBIS PARIS") peut trancher — candidat pour jugerLibellesHotel
// (connector-mistral), pas une détection en soi.
export function identifierCandidatsJugementHotel(
  ecritures: EcritureTvaComplete[],
  nomsComptesFournisseur: Map<string, string>
): CandidatJugementHotel[] {
  const candidats: CandidatJugementHotel[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    if (montantTva === 0) continue;

    const ligneTiers = ecriture.lignesTiers[0];
    if (!ligneTiers) continue;

    const nomFournisseur = nomsComptesFournisseur.get(ligneTiers.compte);
    // Déjà couvert par le contrôle déterministe (nom de compte explicite) —
    // ne pas re-proposer au LLM, ce serait redondant.
    if (nomFournisseur && /h[ôo]tel/i.test(nomFournisseur)) continue;

    candidats.push({ ledgerEntryId: ecriture.ligneTva.ledgerEntryId, libelle: ecriture.ligneTva.libelle });
  }

  return candidats;
}
