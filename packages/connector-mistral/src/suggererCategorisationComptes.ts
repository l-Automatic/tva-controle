import type { MistralClient } from './client.js';

export type CategorieSuggeree =
  | 'comptes_vente_service'
  | 'comptes_charge_service'
  | 'comptes_equipement'
  | 'comptes_carburant'
  | 'comptes_cadeaux'
  | 'comptes_immobilisation'
  | 'comptes_entretien_vehicule'
  | 'comptes_location_vehicule'
  | 'comptes_vente_export';

export interface SuggestionCategorisation {
  compte: string;
  categorieSuggeree: CategorieSuggeree | null; // null si l'IA ne se prononce pas
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
}

// Suggère une catégorie pour chaque compte à catégoriser (10/08, demande
// répétée de Rami — jamais construite jusqu'ici malgré plusieurs
// signalements, seulement vérifié à tort que ce n'était "pas une
// régression"). Se base uniquement sur le numéro de compte et les
// libellés déjà extraits (CompteACategoriser.exemplesLibelle) — aucun
// nouvel appel réseau nécessaire, cette donnée existe déjà.
//
// PRINCIPE DE PRUDENCE, comme tous les jugements IA de ce projet : une
// simple suggestion à confirmer, jamais appliquée automatiquement.
// categorieSuggeree à null quand l'IA n'a pas assez d'indice pour se
// prononcer — jamais une catégorie devinée au hasard pour remplir la
// réponse.
export async function suggererCategorisationComptes(
  client: MistralClient,
  comptes: { compte: string; exemplesLibelle: string[] }[]
): Promise<SuggestionCategorisation[]> {
  if (comptes.length === 0) return [];

  const systemPrompt =
    `Tu es un assistant qui aide un collaborateur de cabinet comptable ` +
    `français à catégoriser des comptes du plan comptable général (PCG), ` +
    `pour la déclaration de TVA. Pour chaque compte, tu proposes UNE des ` +
    `catégories suivantes, ou aucune si tu n'as pas assez d'indice :\n` +
    `- comptes_vente_service : compte de VENTE (70x) pour une prestation de service\n` +
    `- comptes_charge_service : compte de CHARGE (60x-62x) pour une prestation de service reçue\n` +
    `- comptes_equipement : achat de petit équipement/matériel\n` +
    `- comptes_carburant : achat de carburant (essence, gazole...)\n` +
    `- comptes_cadeaux : cadeaux offerts à des clients\n` +
    `- comptes_immobilisation : achat d'immobilisation (bien durable, 21x)\n` +
    `- comptes_entretien_vehicule : entretien/réparation de véhicule\n` +
    `- comptes_location_vehicule : location/crédit-bail de véhicule\n` +
    `- comptes_vente_export : vente à l'export (hors UE)\n\n` +
    `Base-toi sur le numéro de compte (les tranches du PCG sont un indice ` +
    `fort) et les libellés d'écritures fournis. Si le numéro de compte et ` +
    `les libellés ne donnent aucune indication claire, réponds ` +
    `categorieSuggeree: null plutôt que de deviner — un mauvais classement ` +
    `a un impact fiscal réel, un faux négatif (null) est toujours ` +
    `préférable à un faux positif. Réponds uniquement en JSON, sans texte ` +
    `hors du JSON.`;

  const comptesTexte = comptes
    .map((c) => `- compte ${c.compte}, libellés vus : ${c.exemplesLibelle.map((l) => `"${l}"`).join(', ') || '(aucun)'}`)
    .join('\n');

  const userPrompt =
    `Comptes à catégoriser :\n${comptesTexte}\n\n` +
    `Réponds avec ce format JSON exact : {"suggestions": [{"compte": ` +
    `"...", "categorieSuggeree": "comptes_xxx"|null, "confiance": ` +
    `"haute|moyenne|basse", "justification": "une phrase courte"}]}. Une ` +
    `entrée par compte listé ci-dessus, dans le même ordre.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireSuggestions(
    brut,
    comptes.map((c) => c.compte)
  );
}

const CATEGORIES_VALIDES: CategorieSuggeree[] = [
  'comptes_vente_service',
  'comptes_charge_service',
  'comptes_equipement',
  'comptes_carburant',
  'comptes_cadeaux',
  'comptes_immobilisation',
  'comptes_entretien_vehicule',
  'comptes_location_vehicule',
  'comptes_vente_export',
];

function validerEtExtraireSuggestions(brut: unknown, comptesAttendus: string[]): SuggestionCategorisation[] {
  if (typeof brut !== 'object' || brut === null || !('suggestions' in brut)) return [];
  const suggestions = (brut as { suggestions: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];

  const comptesConnus = new Set(comptesAttendus);
  const resultat: SuggestionCategorisation[] = [];

  for (const item of suggestions) {
    if (typeof item !== 'object' || item === null) continue;
    const { compte, categorieSuggeree, confiance, justification } = item as Record<string, unknown>;

    if (typeof compte !== 'string' || !comptesConnus.has(compte)) continue;
    if (confiance !== 'haute' && confiance !== 'moyenne' && confiance !== 'basse') continue;
    const categorieValide =
      categorieSuggeree === null || (typeof categorieSuggeree === 'string' && CATEGORIES_VALIDES.includes(categorieSuggeree as CategorieSuggeree));
    if (!categorieValide) continue;

    resultat.push({
      compte,
      categorieSuggeree: (categorieSuggeree as CategorieSuggeree | null) ?? null,
      confiance,
      justification: typeof justification === 'string' ? justification : '',
    });
  }

  return resultat;
}
