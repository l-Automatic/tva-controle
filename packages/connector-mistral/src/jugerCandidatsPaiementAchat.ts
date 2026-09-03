import type { MistralClient } from './client.js';

// Module 5, volet achats — rapprochement de paiement (10/08, refonte
// complète demandée par Rami). Remplace jugerPaiementPartielAchat : au
// lieu de rendre un seul montant global pour tout un ensemble de lignes
// rapprochées automatiquement (ancien mécanisme, retiré), cette fonction
// précoche CHAQUE candidat de paiement individuellement, pour un popup où
// le collaborateur voit d'abord la proposition de l'IA puis corrige et
// valide lui-même — jamais une décision finale prise par le LLM seul.
//
// PRINCIPE NON NÉGOCIABLE, inchangé : le LLM JUGE, le CODE CALCULE. Cette
// fonction ne retourne jamais un prorata ni un montant — seulement, pour
// chaque candidat, s'il semble raisonnablement lié à la facture (booléen)
// et avec quel niveau de confiance.
//
// Prudence par défaut, explicitement demandée par Rami : si le LLM ne
// peut pas se prononcer de façon fiable sur l'ensemble (cas trop
// complexe), il ne précoche RIEN plutôt que de deviner — retourne
// `precochage: null`, pas un tableau de faux "non" qui aurait l'air d'un
// vrai résultat. Le popup s'affiche alors entièrement vide de coches,
// jamais une fausse certitude.
export interface CandidatPaiementInput {
  ledgerEntryId: number;
  libelle: string | null;
  montant: number;
  date: string;
}

export interface CandidatPreCoche {
  ledgerEntryId: number;
  precoche: boolean;
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
}

export interface JugementRapprochementPaiements {
  // null = le LLM n'a pas pu se prononcer de façon fiable sur cet
  // ensemble — rien n'est précoché, jamais une déduction devinée.
  candidats: CandidatPreCoche[] | null;
}

export async function jugerCandidatsPaiementAchat(
  client: MistralClient,
  facture: { libelle: string | null; montant: number; date: string },
  candidats: CandidatPaiementInput[]
): Promise<JugementRapprochementPaiements> {
  if (candidats.length === 0) return { candidats: null };

  const systemPrompt =
    `Tu es un assistant qui aide à analyser une facture fournisseur française ` +
    `et une liste de mouvements de règlement candidats sur le même compte ` +
    `fournisseur, pour déterminer LESQUELS de ces règlements correspondent ` +
    `vraisemblablement à un paiement (total ou partiel) de CETTE facture ` +
    `précise.\n\n` +
    `SIGNAL LE PLUS FORT, à ne jamais sous-estimer : si le libellé d'un ` +
    `règlement reprend le même nom ou une variante proche du libellé de la ` +
    `facture (ex: facture "ACCORD HOTEL" et règlement "CB ACCORD HOTEL"), ` +
    `c'est en pratique la meilleure preuve de lien qui existe — aussi fiable ` +
    `qu'une mention explicite du mot "acompte". Ne l'écarte jamais au profit ` +
    `d'un mouvement sans rapport juste parce qu'aucun mot-clé de type ` +
    `"acompte" n'apparaît littéralement.\n\n` +
    `Autres indices possibles, moins forts mais utiles en complément : le ` +
    `libellé de la facture elle-même (modalités de paiement du type ` +
    `"50/50", échéancier, référence), le libellé du règlement avec une ` +
    `mention abrégée ou explicite ("acpt", "acompte", "1er versement", et ` +
    `bien d'autres formulations possibles — ne te limite pas à une liste ` +
    `fixe), la proximité des dates, et la cohérence du montant (un ` +
    `règlement dont le montant dépasse largement celui de la facture est ` +
    `suspect, sauf indice contraire clair).\n\n` +
    `Pour CHAQUE candidat, réponds individuellement s'il te semble ` +
    `raisonnablement lié à cette facture (precoche: true) ou non ` +
    `(precoche: false), avec un niveau de confiance. Ne précoche true que ` +
    `si tu as un signal réel — l'absence de signal doit donner false, pas ` +
    `un true par défaut. Si l'ensemble est trop complexe ou ambigu pour te ` +
    `prononcer de façon fiable sur AUCUN des candidats (plusieurs factures ` +
    `mélangées sans distinction possible, aucun indice exploitable du ` +
    `tout...), réponds avec un tableau vide plutôt que de deviner au hasard ` +
    `— une fausse déduction de TVA est plus grave qu'une absence de ` +
    `proposition. Réponds uniquement en JSON, sans texte hors du JSON.`;

  const factureTexte = `Facture : "${facture.libelle ?? '(libellé vide)'}", montant ${facture.montant}, date ${facture.date}.`;
  const candidatsTexte = candidats
    .map(
      (c, i) =>
        `- Candidat ${i + 1} (id ${c.ledgerEntryId}, ${c.date}) : "${c.libelle ?? '(libellé vide)'}", montant ${c.montant}`
    )
    .join('\n');

  const userPrompt =
    `${factureTexte}\n\nCandidats de règlement :\n${candidatsTexte}\n\n` +
    `Réponds avec ce format JSON exact : {"candidats": [{"ledgerEntryId": ` +
    `<nombre>, "precoche": true|false, "confiance": "haute|moyenne|basse", ` +
    `"justification": "une phrase courte"}, ...]} — un objet par candidat, ` +
    `dans le même ordre.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireJugement(brut, candidats);
}

function validerEtExtraireJugement(
  brut: unknown,
  candidatsAttendus: CandidatPaiementInput[]
): JugementRapprochementPaiements {
  if (typeof brut !== 'object' || brut === null) return { candidats: null };

  const { candidats } = brut as Record<string, unknown>;
  if (!Array.isArray(candidats)) return { candidats: null };

  const idsAttendus = new Set(candidatsAttendus.map((c) => c.ledgerEntryId));
  const resultat: CandidatPreCoche[] = [];

  for (const item of candidats) {
    if (typeof item !== 'object' || item === null) return { candidats: null };
    const { ledgerEntryId, precoche, confiance, justification } = item as Record<string, unknown>;

    if (typeof ledgerEntryId !== 'number' || !idsAttendus.has(ledgerEntryId)) return { candidats: null };
    if (typeof precoche !== 'boolean') return { candidats: null };
    if (confiance !== 'haute' && confiance !== 'moyenne' && confiance !== 'basse') return { candidats: null };

    resultat.push({
      ledgerEntryId,
      precoche,
      confiance,
      justification: typeof justification === 'string' ? justification : '',
    });
  }

  // Chaque candidat attendu doit avoir une réponse — une réponse partielle
  // est traitée comme non fiable dans son ensemble, jamais complétée à
  // moitié par défaut.
  if (resultat.length !== candidatsAttendus.length) return { candidats: null };

  return { candidats: resultat };
}
