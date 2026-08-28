import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// TVA intracom, volet livraisons (10/08) — une livraison intracommunautaire
// (vente à un client professionnel d'un autre pays membre de l'UE) est
// exonérée de TVA française par nature. Si une ligne de TVA apparaît quand
// même sur une pièce touchant le compte de vente confirmé pour ce type de
// livraison, c'est une erreur de saisie certaine — pas une nuance
// d'appréciation, même logique que le contrôle hôtel (coherenceHotel.ts).
//
// Toute écriture présente dans `ecritures` a, par construction, une vraie
// ligne de TVA avec un montant réel (le connecteur ne construit
// EcritureTvaComplete qu'à partir de mouvements réels sur les comptes de
// la famille TVA) — donc une pièce touchant ce compte confirmé qui
// apparaît ici a nécessairement une TVA non nulle associée, pas besoin de
// vérifier ailleurs qu'un montant zéro serait le cas normal absent.
export function verifierAbsenceTvaLivraisonIntracom(
  ecritures: EcritureTvaComplete[],
  comptesVenteIntracomExoneree: string[]
): Anomalie[] {
  if (comptesVenteIntracomExoneree.length === 0) return [];

  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    const toucheCompteExonere = ecriture.autresLignes.some((l) =>
      comptesVenteIntracomExoneree.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (!toucheCompteExonere) continue;

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    if (montantTva === 0) continue;

    anomalies.push({
      type: 'tva_sur_livraison_intracom_exoneree',
      gravite: 'bloquant',
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      compte: ecriture.ligneTva.compte,
      description:
        `TVA de ${montantTva.toFixed(2)}€ présente sur une pièce touchant un compte de livraison ` +
        `intracommunautaire exonérée : une livraison intracom ne doit jamais porter de TVA française. ` +
        `Erreur de saisie probable, à corriger dans Pennylane avant de poursuivre.`,
      details: { montantTva, libelle: ecriture.ligneTva.libelle },
    });
  }

  return anomalies;
}
