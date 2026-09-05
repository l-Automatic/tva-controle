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
//
// Consolidé (10/08, demande de Rami) : AU PLUS une anomalie de chaque type
// par appel, listant TOUS les numéros concernés — plutôt qu'une anomalie
// séparée par trou ou par numéro dupliqué. Objectif explicite : que le
// collaborateur voie en un coup d'œil tout ce qui manque pour interroger
// le client, au lieu d'un signalement éclaté. Chaque cycle redétecte
// entièrement depuis zéro (aucune mémoire d'un "Ignorer" passé) — un
// numéro toujours manquant d'une période à l'autre réapparaît
// naturellement dans la nouvelle anomalie consolidée, sans rien à
// construire de spécial pour ça.
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
  const formater = (n: number) => `${motif.prefixe}${String(n).padStart(motif.nombreChiffres ?? 0, '0')}${motif.suffixe}`;

  // Doublons : un même numéro utilisé sur plusieurs pièces distinctes —
  // TOUS les numéros dupliqués regroupés en une seule anomalie.
  const parNumero = new Map<number, number[]>();
  for (const n of numeros) {
    const liste = parNumero.get(n.numero) ?? [];
    liste.push(n.ledgerEntryId);
    parNumero.set(n.numero, liste);
  }
  const doublons = [...parNumero.entries()]
    .filter(([, ledgerEntryIds]) => ledgerEntryIds.length >= 2)
    .map(([numero, ledgerEntryIds]) => ({ numero, ledgerEntryIds }));

  if (doublons.length > 0) {
    anomalies.push({
      type: 'doublon_numerotation_facture',
      gravite: 'signale',
      ledgerEntryId: doublons[0]!.ledgerEntryIds[0]!,
      compte: '',
      description:
        `${doublons.length} numéro(s) de facture utilisé(s) plusieurs fois : ` +
        `${doublons.map((d) => formater(d.numero)).join(', ')} — à vérifier (vraie facture dupliquée, ` +
        `ou numéro réutilisé à tort).`,
      details: { doublons },
    });
  }

  // Trous : TOUS les numéros manquants entre le plus petit et le plus
  // grand numéro distinct rencontré, regroupés en une seule anomalie
  // (les doublons ne créent pas de faux trou entre eux, puisqu'un même
  // numéro ne compte qu'une fois dans cette comparaison).
  const numerosDistincts = [...new Set(numeros.map((n) => n.numero))].sort((a, b) => a - b);
  const manquants: number[] = [];
  for (let i = 1; i < numerosDistincts.length; i++) {
    const precedent = numerosDistincts[i - 1]!;
    const courant = numerosDistincts[i]!;
    for (let n = precedent + 1; n < courant; n++) manquants.push(n);
  }

  if (manquants.length > 0) {
    const dernierNumero = numerosDistincts[numerosDistincts.length - 1]!;
    const ledgerEntryIdRef = numeros.find((n) => n.numero === dernierNumero)!.ledgerEntryId;
    anomalies.push({
      type: 'trou_numerotation_facture',
      gravite: 'signale',
      ledgerEntryId: ledgerEntryIdRef,
      compte: '',
      description:
        `${manquants.length} numéro(s) de facture manquant(s) : ${manquants.map(formater).join(', ')} — ` +
        `à vérifier (facture non comptabilisée, ou numéro sauté volontairement).`,
      details: { manquants },
    });
  }

  return anomalies;
}
