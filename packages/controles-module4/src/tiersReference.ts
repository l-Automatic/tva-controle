import type { EcritureTvaComplete, Anomalie, ContexteDossier } from '@tva-controle/core';

export interface StatutTiers {
  ledgerEntryId: number;
  numeroCompteTiers: string;
  nomTiers: string | null;
  estNouveau: boolean;
}

// "Nouveau tiers" : compte client/fournisseur (401/411) jamais vu lors d'un
// cycle précédent pour ce dossier (cf. tiers_reference, alimentée après ce
// contrôle par Module 9 — voir writeRepository.synchroniserTiersReference).
//
// Signalé, pas bloquant : un nouveau partenaire commercial n'est pas en soi
// un problème fiscal, juste un point à vérifier. L'appréciation du RISQUE
// proprement dite (fournisseur fictif, pattern de fraude à la TVA...)
// nécessiterait un jugement sur le libellé du tiers — Module 5 (LLM), non
// construit à ce stade. Ce contrôle se limite donc à la détection
// déterministe "vu pour la première fois" ; le jugement de risque reste
// pour l'instant entièrement humain, comme la qualification des
// encaissements non affectés (cf. encaissementNonAffecte.ts).
export function verifierNouveauxTiers(
  ecritures: EcritureTvaComplete[],
  contexteDossier: ContexteDossier
): { statuts: StatutTiers[]; anomalies: Anomalie[] } {
  const tiersConnus = new Set(contexteDossier.tiersConnus ?? []);

  // Dédup par compte : un même tiers peut apparaître sur plusieurs écritures
  // dans la période, on ne veut qu'une anomalie par tiers, pas une par pièce.
  const vus = new Map<string, { ledgerEntryId: number; nomTiers: string | null }>();
  for (const ecriture of ecritures) {
    for (const ligneTiers of ecriture.lignesTiers) {
      if (!vus.has(ligneTiers.compte)) {
        vus.set(ligneTiers.compte, {
          ledgerEntryId: ecriture.ledgerEntryId,
          nomTiers: ligneTiers.libelleCompte,
        });
      }
    }
  }

  const statuts: StatutTiers[] = [];
  const anomalies: Anomalie[] = [];

  for (const [compte, { ledgerEntryId, nomTiers }] of vus) {
    const estNouveau = !tiersConnus.has(compte);
    statuts.push({ ledgerEntryId, numeroCompteTiers: compte, nomTiers, estNouveau });
    if (estNouveau) {
      anomalies.push({
        type: 'nouveau_tiers_a_verifier',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description:
          `Nouveau tiers jamais contrôlé pour ce dossier : ${nomTiers ?? compte} (compte ${compte}). ` +
          `Vérification manuelle recommandée avant de lui accorder confiance.`,
        details: { nomTiers },
      });
    }
  }

  return { statuts, anomalies };
}
