import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// Seuil légal de déduction TVA sur les cadeaux d'entreprise, par
// bénéficiaire et par an (BOI-TVA-DED-30-30-30) — actuellement 73€ TTC.
// Rami (10/08) : le suivi par bénéficiaire/an est un vrai angle mort
// (aucune notion de bénéficiaire dans nos données), volontairement
// ignoré — une seule transaction qui dépasse déjà ce seuil est une
// certitude suffisante en soi, jamais un faux positif.
const SEUIL_CADEAU_TTC_PAR_DEFAUT = 73;

export interface ConfigCadeauClient {
  comptesCadeaux: string[];
  seuilTtc?: number;
}

// Bloquant : quand ça se déclenche, c'est une certitude (montant réel
// dépassé + TVA réellement déduite), jamais une question d'appréciation.
export function detecterCadeauClientSeuilDepasse(
  ecritures: EcritureTvaComplete[],
  config: ConfigCadeauClient
): Anomalie[] {
  const seuil = config.seuilTtc ?? SEUIL_CADEAU_TTC_PAR_DEFAUT;
  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    if (montantTva <= 0) continue; // rien de déduit, rien à signaler

    const ligneCadeau = ecriture.autresLignes.find((l) =>
      config.comptesCadeaux.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (!ligneCadeau) continue;

    const montantHt = Math.abs(ligneCadeau.debit - ligneCadeau.credit);
    const montantTtc = montantHt + montantTva;
    if (montantTtc <= seuil) continue;

    anomalies.push({
      type: 'cadeau_client_seuil_depasse',
      gravite: 'bloquant',
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      compte: ligneCadeau.compte,
      description: `Cadeau client de ${montantTtc.toFixed(2)} € TTC — au-delà du seuil légal de ${seuil} € TTC, la TVA n'est pas déductible du tout (${montantTva.toFixed(2)} € déduits à tort).`,
      details: { montantTtc, montantTva, seuil },
    });
  }

  return anomalies;
}
