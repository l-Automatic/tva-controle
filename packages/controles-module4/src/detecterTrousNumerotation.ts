import type { Anomalie } from '@tva-controle/core';

export interface MotifNumerotationConfirme {
  prefixe: string;
  suffixe: string;
  nombreChiffres: number | null;
}

// Extrait le compteur séquentiel d'un numéro de pièce, en retirant le
// préfixe/suffixe confirmés. Retourne null si le numéro ne correspond pas au
// motif (ignoré, jamais signalé à tort — cf. limite assumée dans
// decouvrirMotifNumerotation.ts : un dossier avec plusieurs séries n'aura
// qu'une série couverte par ce contrôle).
export function extraireNumeroSequence(numeroPiece: string, motif: MotifNumerotationConfirme): number | null {
  if (!numeroPiece.startsWith(motif.prefixe) || !numeroPiece.endsWith(motif.suffixe)) return null;

  const finPrefixe = motif.prefixe.length;
  const debutSuffixe = motif.suffixe.length > 0 ? numeroPiece.length - motif.suffixe.length : numeroPiece.length;
  const partieNumerique = numeroPiece.slice(finPrefixe, debutSuffixe);

  if (!/^\d+$/.test(partieNumerique)) return null;
  if (motif.nombreChiffres !== null && partieNumerique.length !== motif.nombreChiffres) return null;

  return Number.parseInt(partieNumerique, 10);
}

// Module 5 (numérotation) — applique un motif CONFIRMÉ (jamais découvert
// ici, cf. decouvrirMotifNumerotation.ts pour la découverte LLM, distincte
// et déclenchée manuellement). Détection purement déterministe elle-même —
// mais l'appelant (pipeline.ts) doit fournir le vrai piece_number de
// l'écriture, jamais un libellé de ligne (texte libre non structuré).
//
// Ne bloque JAMAIS le calcul — décision explicite reprise de la toute
// première conversation du projet : un trou de numérotation informe le
// travail de contrôle, il n'empêche pas de calculer la TVA.
export function detecterTrousNumerotation(
  factures: { ledgerEntryId: number; numeroPiece: string | null }[],
  motif: MotifNumerotationConfirme
): Anomalie[] {
  const numeros: { ledgerEntryId: number; numero: number }[] = [];

  for (const f of factures) {
    if (!f.numeroPiece) continue;
    const numero = extraireNumeroSequence(f.numeroPiece, motif);
    if (numero !== null) numeros.push({ ledgerEntryId: f.ledgerEntryId, numero });
  }

  if (numeros.length < 2) return [];

  numeros.sort((a, b) => a.numero - b.numero);

  const anomalies: Anomalie[] = [];
  for (let i = 1; i < numeros.length; i++) {
    const precedent = numeros[i - 1]!;
    const courant = numeros[i]!;
    const ecart = courant.numero - precedent.numero;
    if (ecart <= 1) continue;

    const manquants = ecart - 1;
    anomalies.push({
      type: 'trou_numerotation_facture',
      gravite: 'signale',
      ledgerEntryId: courant.ledgerEntryId,
      compte: '',
      description:
        `${manquants} numéro(s) de facture manquant(s) entre ${motif.prefixe}${String(precedent.numero).padStart(motif.nombreChiffres ?? 0, '0')}${motif.suffixe} ` +
        `et ${motif.prefixe}${String(courant.numero).padStart(motif.nombreChiffres ?? 0, '0')}${motif.suffixe} — ` +
        `à vérifier (facture non comptabilisée, ou numéro sauté volontairement).`,
      details: { numeroPrecedent: precedent.numero, numeroCourant: courant.numero, manquants },
    });
  }

  return anomalies;
}
