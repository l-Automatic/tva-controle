import type { MistralClient } from './client.js';

export interface JugementHotel {
  ledgerEntryId: number;
  estHotel: boolean;
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
}

// Extension du contrôle hôtel déterministe (controles-module4/coherenceHotel.ts),
// pour le cas que celui-ci ne peut PAS couvrir : un compte fournisseur
// générique ("fournisseurs divers"), où seul le libellé de l'ÉCRITURE porte
// le nom précis de l'hôtel (ex: "IBIS PARIS 12/01", "NOVOTEL LYON PART DIEU")
// — jamais le mot générique "hôtel" lui-même, d'après le retour terrain de
// Rami. Reconnaître une chaîne hôtelière est une tâche de connaissance
// générale, pas un motif regex fiable — d'où le LLM ici, contrairement au
// contrôle déterministe qui se contente d'un test sur le nom du compte.
//
// PRINCIPE DE PRUDENCE SPÉCIFIQUE à ce jugement : contrairement à la
// détection déterministe (bloquante, jamais fausse par construction), un
// jugement LLM sur un nom de marque PEUT se tromper (faux positif sur un
// nom qui ressemble à un hôtel sans en être un, faux négatif sur une chaîne
// obscure non reconnue). L'appelant doit donc traiter le résultat comme
// 'signale' (à vérifier par un humain), JAMAIS comme 'bloquant' au même
// titre que la détection déterministe — voir pipeline.ts.
export async function jugerLibellesHotel(
  client: MistralClient,
  ecritures: { ledgerEntryId: number; libelle: string | null }[]
): Promise<JugementHotel[]> {
  if (ecritures.length === 0) return [];

  const systemPrompt =
    `Tu es un assistant qui aide à repérer, parmi des libellés d'écritures ` +
    `comptables françaises, ceux qui correspondent probablement à une nuit ` +
    `d'hôtel (facture d'hébergement). Base-toi sur ta connaissance des ` +
    `enseignes hôtelières françaises et internationales courantes (Ibis, ` +
    `Novotel, Mercure, Best Western, B&B Hôtels, Kyriad, Campanile, Première ` +
    `Classe, Accor, Marriott, Ibis Budget, Hôtel de/du/des...) et des motifs ` +
    `habituels (nom d'enseigne + ville, ou simplement "HOTEL"/"HÔTEL" dans le ` +
    `libellé). Réponds estHotel: false si le libellé ne ressemble à rien de ` +
    `tout ça ou si tu hésites — un faux positif serait plus gênant qu'un faux ` +
    `négatif ici (l'humain vérifiera de toute façon). Tu ne prends aucune ` +
    `décision définitive : un comptable validera ou rejettera ta réponse. ` +
    `Réponds uniquement en JSON, sans texte hors du JSON.`;

  const ecrituresTexte = ecritures
    .map((e) => `- id ${e.ledgerEntryId} : "${e.libelle ?? '(libellé vide)'}"`)
    .join('\n');

  const userPrompt =
    `Écritures à examiner :\n${ecrituresTexte}\n\n` +
    `Réponds avec ce format JSON exact : ` +
    `{"jugements": [{"ledgerEntryId": ..., "estHotel": true|false, ` +
    `"confiance": "haute|moyenne|basse", "justification": "une phrase courte"}]}. ` +
    `Une entrée par écriture listée ci-dessus, dans le même ordre.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireJugements(
    brut,
    ecritures.map((e) => e.ledgerEntryId)
  );
}

function validerEtExtraireJugements(brut: unknown, idsAttendus: number[]): JugementHotel[] {
  if (typeof brut !== 'object' || brut === null || !('jugements' in brut)) return [];
  const jugements = (brut as { jugements: unknown }).jugements;
  if (!Array.isArray(jugements)) return [];

  const idsConnus = new Set(idsAttendus);
  const resultat: JugementHotel[] = [];

  for (const item of jugements) {
    if (typeof item !== 'object' || item === null) continue;
    const { ledgerEntryId, estHotel, confiance, justification } = item as Record<string, unknown>;

    if (typeof ledgerEntryId !== 'number' || !idsConnus.has(ledgerEntryId)) continue;
    if (typeof estHotel !== 'boolean') continue;
    if (confiance !== 'haute' && confiance !== 'moyenne' && confiance !== 'basse') continue;

    resultat.push({
      ledgerEntryId,
      estHotel,
      confiance,
      justification: typeof justification === 'string' ? justification : '',
    });
  }

  return resultat;
}
