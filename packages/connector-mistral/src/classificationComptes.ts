import type { MistralClient } from './client.js';

export interface CategorieClassification {
  cle: string;
  description: string;
}

export interface SuggestionClassificationCompte {
  compte: string;
  categorieSuggeree: string | null;
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
  // Absent ou 'ia' = vient d'un appel Mistral. 'plan_comptable' = déduit
  // directement du référentiel déterministe (controles-module4), aucun
  // appel réseau — présenté différemment côté interface (badge "déterminé
  // par le plan comptable" plutôt qu'un niveau de confiance).
  source?: 'ia' | 'plan_comptable';
}

// Premier vrai usage du LLM dans ce projet (10/08) — sert deux besoins en
// attente depuis longtemps avec le même mécanisme : la présélection du
// popup de catégorisation des comptes, et l'identification du compte
// autoliquidation par son libellé (proposée par Rami : le libellé indique
// systématiquement le cas, mais pas garanti selon les cabinets).
//
// Bug réel corrigé (10/08) après un premier essai en conditions réelles :
// on envoyait au départ le libellé d'UNE écriture prise au hasard dans
// l'historique du compte (texte libre, spécifique à une transaction — ex:
// "Péage A6 15/01"), pas le NOM DU COMPTE lui-même tel que défini dans le
// plan comptable (ex: "625100 — Voyages et déplacements"). Résultat
// concret : un compte de frais de déplacement classé "carburant" à cause
// d'une seule écriture ambiguë parmi des dizaines. Corrigé : on envoie
// maintenant le nom officiel du compte (résolu via resolveLedgerAccounts
// côté appelant), jamais un libellé d'écriture individuelle.
//
// PRINCIPE NON NÉGOCIABLE, comme partout ailleurs dans ce projet : cette
// fonction ne retourne que des SUGGESTIONS. Rien ici ne confirme, n'écrit,
// ni n'influence directement un calcul. L'appelant doit persister le
// résultat en 'candidate' (via les mécanismes déjà existants :
// ajouterConventionManuelle, enregistrerPropositionsTauxTiers...) et
// attendre une confirmation humaine avant tout impact réel — exactement
// comme les propositions déterministes (taux historique, autoliquidation
// détectée par équilibre comptable).
//
// Si l'appel échoue (réseau, clé absente, réponse malformée), cette
// fonction lève une erreur — c'est à l'appelant de décider s'il continue
// SANS présélection (dégradation gracieuse, cf. pipeline.ts) plutôt que de
// faire échouer tout le cycle pour un aléa d'un service tiers optionnel.
export async function suggererClassificationComptes(
  client: MistralClient,
  comptes: { compte: string; nomCompte: string | null }[],
  categories: CategorieClassification[]
): Promise<SuggestionClassificationCompte[]> {
  if (comptes.length === 0) return [];

  const systemPrompt =
    `Tu es un assistant qui aide à catégoriser des comptes comptables français ` +
    `(plan comptable général) à partir de leur numéro et de leur NOM OFFICIEL ` +
    `dans le plan comptable du dossier (ex: "625100 — Voyages et déplacements"). ` +
    `Base-toi UNIQUEMENT sur le numéro et ce nom officiel — jamais sur une ` +
    `supposition à propos d'écritures individuelles que tu ne vois pas. Tu ne ` +
    `prends aucune décision définitive : tes réponses sont des suggestions qu'un ` +
    `comptable humain validera ou rejettera.\n\n` +
    `RÈGLE LA PLUS IMPORTANTE : la plupart des comptes qu'on te donne ne rentrent ` +
    `dans AUCUNE des catégories listées — c'est normal et attendu, pas un échec. ` +
    `Les catégories listées sont des EXCEPTIONS à repérer, pas des cases que tu dois ` +
    `remplir à tout prix. Réponds categorie: null dès que le compte ne correspond ` +
    `clairement à aucune catégorie, ou si tu hésites, ou si le nom du compte est ` +
    `absent/peu clair — ne choisis JAMAIS "la moins mauvaise option" par défaut. ` +
    `Une suggestion fausse présentée avec assurance est pire qu'une absence de ` +
    `suggestion.\n\n` +
    `Repères du plan comptable général à connaître, pour éviter les confusions ` +
    `fréquentes bien/service :\n` +
    `- Comptes 601 à 607 (achats stockés : matières premières, fournitures, ` +
    `marchandises) : ce sont des BIENS, presque jamais des prestations de service, ` +
    `même si le nom contient des mots génériques comme "achat" ou "fourniture".\n` +
    `- Comptes 6063/6064/6068 (fournitures non stockables, petites fournitures ` +
    `d'entretien ou administratives) : à rapprocher d'une catégorie "petit ` +
    `équipement" si elle existe dans la liste, jamais d'une catégorie "service".\n` +
    `- Comptes 611 (sous-traitance) : souvent un service.\n` +
    `- Comptes 625X (déplacements, missions, réceptions) : ce sont des SERVICES ` +
    `(péages, hôtels, restaurants, transport) — ne jamais les classer "carburant" ` +
    `simplement parce que le mot "déplacement" évoque la route.\n` +
    `- Comptes 6061/6062 (eau, énergie, fournitures non stockables) : ni un bien ` +
    `classique ni une prestation de service au sens fiscal du terme — categorie: ` +
    `null sauf si une catégorie de la liste les couvre explicitement (ex: carburant, ` +
    `mais seulement si le nom du compte le confirme explicitement).\n\n` +
    `Réponds uniquement en JSON, au format demandé, sans texte hors du JSON.`;

  const categoriesTexte = categories.map((c) => `- ${c.cle} : ${c.description}`).join('\n');
  const comptesTexte = comptes
    .map((c) => `- Compte ${c.compte}, nom officiel : ${c.nomCompte ?? '(nom inconnu)'}`)
    .join('\n');

  const userPrompt =
    `Catégories possibles :\n${categoriesTexte}\n\n` +
    `Comptes à classer :\n${comptesTexte}\n\n` +
    `Réponds avec ce format JSON exact : ` +
    `{"suggestions": [{"compte": "...", "categorie": "une des clés ci-dessus, ou null si aucune ne convient", ` +
    `"confiance": "haute|moyenne|basse", "justification": "une phrase courte"}]}. ` +
    `Une entrée par compte listé ci-dessus, dans le même ordre.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireSuggestions(brut, comptes.map((c) => c.compte));
}

function validerEtExtraireSuggestions(brut: unknown, comptesAttendus: string[]): SuggestionClassificationCompte[] {
  if (typeof brut !== 'object' || brut === null || !('suggestions' in brut)) {
    return [];
  }
  const suggestions = (brut as { suggestions: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];

  const comptesConnus = new Set(comptesAttendus);
  const resultat: SuggestionClassificationCompte[] = [];

  for (const item of suggestions) {
    if (typeof item !== 'object' || item === null) continue;
    const { compte, categorie, confiance, justification } = item as Record<string, unknown>;

    if (typeof compte !== 'string' || !comptesConnus.has(compte)) continue;
    if (categorie !== null && typeof categorie !== 'string') continue;
    if (confiance !== 'haute' && confiance !== 'moyenne' && confiance !== 'basse') continue;

    resultat.push({
      compte,
      categorieSuggeree: categorie,
      confiance,
      justification: typeof justification === 'string' ? justification : '',
      source: 'ia',
    });
  }

  return resultat;
}
