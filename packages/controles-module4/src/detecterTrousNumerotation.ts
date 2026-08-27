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
// travail de contrôle, il n'empêche pas de calculer la TVA. Même principe
// appliqué aux doublons (10/08) — un numéro de facture réutilisé deux fois
// est tout aussi informatif qu'un trou, jamais bloquant.
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

  const anomalies: Anomalie[] = [];

  // Doublons (10/08) : un même numéro utilisé sur plusieurs pièces
  // distinctes — regroupé par numéro, une seule anomalie même si le
  // numéro apparaît 3 fois ou plus, avec toutes les pièces concernées.
  const parNumero = new Map<number, number[]>();
  for (const n of numeros) {
    const liste = parNumero.get(n.numero) ?? [];
    liste.push(n.ledgerEntryId);
    parNumero.set(n.numero, liste);
  }
  for (const [numero, ledgerEntryIds] of parNumero) {
    if (ledgerEntryIds.length < 2) continue;
    anomalies.push({
      type: 'doublon_numerotation_facture',
      gravite: 'signale',
      ledgerEntryId: ledgerEntryIds[0]!,
      compte: '',
      description:
        `Le numéro de facture ${motif.prefixe}${String(numero).padStart(motif.nombreChiffres ?? 0, '0')}${motif.suffixe} ` +
        `apparaît sur ${ledgerEntryIds.length} pièces distinctes — à vérifier (vraie facture dupliquée, ou ` +
        `numéro réutilisé à tort).`,
      details: { numero, ledgerEntryIds },
    });
  }

  // Trous : comparaison des numéros distincts triés (les doublons ne
  // créent pas de faux trou entre eux, puisqu'un même numéro ne compte
  // qu'une fois dans cette comparaison).
  const numerosDistincts = [...new Set(numeros.map((n) => n.numero))].sort((a, b) => a - b);
  if (numerosDistincts.length < 2) return anomalies;

  const ledgerEntryIdParNumero = new Map(numeros.map((n) => [n.numero, n.ledgerEntryId]));

  for (let i = 1; i < numerosDistincts.length; i++) {
    const precedent = numerosDistincts[i - 1]!;
    const courant = numerosDistincts[i]!;
    const ecart = courant - precedent;
    if (ecart <= 1) continue;

    const manquants = ecart - 1;
    anomalies.push({
      type: 'trou_numerotation_facture',
      gravite: 'signale',
      ledgerEntryId: ledgerEntryIdParNumero.get(courant)!,
      compte: '',
      description:
        `${manquants} numéro(s) de facture manquant(s) entre ${motif.prefixe}${String(precedent).padStart(motif.nombreChiffres ?? 0, '0')}${motif.suffixe} ` +
        `et ${motif.prefixe}${String(courant).padStart(motif.nombreChiffres ?? 0, '0')}${motif.suffixe} — ` +
        `à vérifier (facture non comptabilisée, ou numéro sauté volontairement).`,
      details: { numeroPrecedent: precedent, numeroCourant: courant, manquants },
    });
  }

  return anomalies;
}
