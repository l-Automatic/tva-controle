import type { MistralClient } from './client.js';

export interface JugementPaiementPartielAchat {
  lienEtabli: boolean;
  montantFacture: number | null;
  montantPayeRattache: number | null;
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
}

// Module 5, volet achats (10/08) — le cas symétrique côté ventes est pur
// calcul (calculerProrataEncaissement), mais côté achats il faut d'abord
// établir, par jugement, si un règlement constitue vraiment un acompte
// rattaché à UNE facture de service précise et identifiable — pas juste un
// paiement isolé, et surtout pas un rapprochement multi-factures où
// l'attribution serait fausse. D'après Rami : les écritures d'acompte
// détaillent souvent les modalités dans le libellé (ex: "50/50", des
// dates) — c'est cette info textuelle, combinée aux montants, qui permet
// de trancher.
//
// PRINCIPE NON NÉGOCIABLE depuis le tout début de ce projet : le LLM
// JUGE, le CODE CALCULE. Cette fonction ne retourne JAMAIS un prorata —
// seulement les DEUX montants (facture, paiement rattaché) que
// l'appelant utilise pour calculer lui-même le ratio, de façon
// déterministe et vérifiable (cf. calculerProrataEncaissement, réutilisée
// telle quelle côté pipeline.ts).
//
// Prudence par défaut : si lienEtabli est false, ou si la confiance est
// basse, l'appelant NE DOIT PAS déduire — cf. exigibilite.ts, qui exclut
// par défaut un achat sans prorata fourni (contrairement aux ventes).
export async function jugerPaiementPartielAchat(
  client: MistralClient,
  lignesGroupe: { libelle: string | null; debit: number; credit: number; date: string }[]
): Promise<JugementPaiementPartielAchat> {
  const parDefautNonEtabli: JugementPaiementPartielAchat = {
    lienEtabli: false,
    montantFacture: null,
    montantPayeRattache: null,
    confiance: 'basse',
    justification: 'Aucune ligne à analyser.',
  };

  if (lignesGroupe.length === 0) return parDefautNonEtabli;

  const systemPrompt =
    `Tu es un assistant qui aide à analyser un groupe de lignes comptables ` +
    `françaises rapprochées ensemble (lettrage), sur un compte fournisseur, ` +
    `pour déterminer s'il s'agit d'un acompte payé sur UNE facture de service ` +
    `précise et identifiable. Base-toi sur les libellés (souvent explicites : ` +
    `mentions de modalités de paiement comme "50/50", des dates d'échéance, ` +
    `des références de facture) et sur les montants (le total facturé doit ` +
    `être identifiable, distinct du ou des montants réellement payés).\n\n` +
    `Ne conclus lienEtabli: true QUE si tu peux identifier avec un niveau de ` +
    `confiance raisonnable : (1) laquelle ou lesquelles des lignes ` +
    `constituent LA facture concernée, (2) quel montant a été RÉELLEMENT payé ` +
    `pour CETTE facture précise (pas le total du groupe si plusieurs factures ` +
    `différentes s'y mélangent). Si le groupe mélange plusieurs factures sans ` +
    `que l'attribution soit claire, ou si tu hésites, réponds lienEtabli: ` +
    `false — ne jamais deviner un lien qui n'est pas clairement établi, une ` +
    `fausse déduction de TVA est plus grave qu'une absence de déduction. Tu ne ` +
    `calcules AUCUN prorata toi-même — donne uniquement les deux montants ` +
    `bruts, le calcul est fait ailleurs. Réponds uniquement en JSON, sans ` +
    `texte hors du JSON.`;

  const lignesTexte = lignesGroupe
    .map(
      (l, i) =>
        `- Ligne ${i + 1} (${l.date}) : "${l.libelle ?? '(libellé vide)'}", débit ${l.debit}, crédit ${l.credit}`
    )
    .join('\n');

  const userPrompt =
    `Groupe de lignes rapprochées :\n${lignesTexte}\n\n` +
    `Réponds avec ce format JSON exact : {"lienEtabli": true|false, ` +
    `"montantFacture": <nombre ou null>, "montantPayeRattache": <nombre ou null>, ` +
    `"confiance": "haute|moyenne|basse", "justification": "une phrase courte"}.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireJugement(brut, parDefautNonEtabli);
}

function validerEtExtraireJugement(
  brut: unknown,
  parDefaut: JugementPaiementPartielAchat
): JugementPaiementPartielAchat {
  if (typeof brut !== 'object' || brut === null) return parDefaut;

  const { lienEtabli, montantFacture, montantPayeRattache, confiance, justification } = brut as Record<
    string,
    unknown
  >;

  if (typeof lienEtabli !== 'boolean') return parDefaut;
  if (confiance !== 'haute' && confiance !== 'moyenne' && confiance !== 'basse') return parDefaut;

  if (!lienEtabli) {
    return {
      lienEtabli: false,
      montantFacture: null,
      montantPayeRattache: null,
      confiance,
      justification: typeof justification === 'string' ? justification : '',
    };
  }

  if (typeof montantFacture !== 'number' || typeof montantPayeRattache !== 'number') return parDefaut;
  if (montantFacture <= 0) return parDefaut; // division par zéro ou incohérence, jamais fiable

  return {
    lienEtabli: true,
    montantFacture,
    montantPayeRattache,
    confiance,
    justification: typeof justification === 'string' ? justification : '',
  };
}
