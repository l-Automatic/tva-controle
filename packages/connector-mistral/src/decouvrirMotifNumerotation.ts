import type { MistralClient } from './client.js';

export interface MotifNumerotation {
  prefixe: string;
  suffixe: string;
  nombreChiffres: number | null; // null si pas de zéros de tête fixes observés
  description: string;
}

// Module 5, canonique depuis la toute première conversation du projet :
// le LLM découvre le motif de numérotation UNE SEULE FOIS (déclenché
// manuellement, cf. orchestrateur-module9), jamais recalculé à chaque
// cycle — ensuite un simple code déterministe applique le motif confirmé.
//
// Choix de sécurité (10/08, discuté avec Rami) : on ne demande PAS au LLM
// de générer une regex (risque de motif mal formé) — seulement une
// décomposition en 3 morceaux simples (préfixe fixe / suffixe fixe /
// nombre de chiffres attendu), que le code applique lui-même ensuite avec
// un simple découpage de chaîne, pas d'eval de motif généré par un modèle.
//
// Bornage à l'exercice en cours (pas tout l'historique) — décision
// explicite : gère naturellement un changement de format d'un exercice à
// l'autre sans jamais invalider silencieusement une confirmation
// antérieure. Une nouvelle proposition ne se déclenche que manuellement
// (bouton dédié), pas automatiquement à chaque nouvel exercice — jugé trop
// rare pour justifier plus qu'un déclenchement manuel.
export async function decouvrirMotifNumerotation(
  client: MistralClient,
  libellesExemples: string[]
): Promise<MotifNumerotation | null> {
  if (libellesExemples.length === 0) return null;

  const systemPrompt =
    `Tu es un assistant qui aide à identifier le motif de numérotation des ` +
    `factures de vente d'une entreprise française, à partir d'exemples réels ` +
    `de libellés d'écritures comptables. Ton rôle est de trouver la PARTIE ` +
    `QUI S'INCRÉMENTE d'une facture à l'autre (le compteur séquentiel), et de ` +
    `la distinguer de toute partie qui reste FIXE le temps d'un exercice (ex: ` +
    `une année comme "2025" dans "FA-2025-042" ne bouge pas d'une facture à ` +
    `l'autre — seul "042" est le compteur ; le préfixe est donc "FA-2025-", ` +
    `pas juste "FA-").\n\n` +
    `IMPORTANT — séries minoritaires : les exemples peuvent mélanger PLUSIEURS ` +
    `séries de numérotation distinctes qui coexistent dans une même ` +
    `comptabilité — la série principale des factures de vente, mais aussi ` +
    `parfois des avoirs, ou des factures d'acompte, chacune avec potentiellement ` +
    `son propre préfixe ou format. Ton travail est d'identifier la série ` +
    `DOMINANTE (celle qui revient le plus souvent, la plus régulière) et de ` +
    `l'exprimer comme motif — IGNORE complètement les numéros qui n'en font ` +
    `pas partie plutôt que d'essayer de les faire entrer de force dans un ` +
    `motif unique qui les couvrirait tous. Un motif qui essaie de couvrir ` +
    `plusieurs séries à la fois n'est jamais correct — mieux vaut un motif ` +
    `propre sur la série dominante seule qu'un motif confus qui les mélange.\n\n` +
    `Si les exemples ne montrent aucune série dominante claire même après avoir ` +
    `écarté les séries minoritaires (numéros complètement hétérogènes, ` +
    `factures saisies à la main sans système), réponds motif: null plutôt que ` +
    `d'inventer un motif qui n'existe pas — une fausse détection créerait de ` +
    `fausses alertes de trou de séquence par la suite. Tu ne prends aucune ` +
    `décision définitive : un comptable confirmera ou rejettera ta proposition ` +
    `avant qu'elle serve à quoi que ce soit. Réponds uniquement en JSON, sans ` +
    `texte hors du JSON.`;

  const exemplesTexte = libellesExemples.map((l) => `- "${l}"`).join('\n');

  const userPrompt =
    `Libellés de factures observés cette année pour ce dossier :\n${exemplesTexte}\n\n` +
    `Réponds avec ce format JSON exact : ` +
    `{"motif": {"prefixe": "...", "suffixe": "...", "nombreChiffres": <nombre ou null>, ` +
    `"description": "une phrase courte expliquant le motif"} } ou {"motif": null} ` +
    `si aucun motif cohérent ne ressort des exemples.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireMotif(brut);
}

function validerEtExtraireMotif(brut: unknown): MotifNumerotation | null {
  if (typeof brut !== 'object' || brut === null || !('motif' in brut)) return null;
  const motif = (brut as { motif: unknown }).motif;
  if (motif === null) return null;
  if (typeof motif !== 'object') return null;

  const { prefixe, suffixe, nombreChiffres, description } = motif as Record<string, unknown>;
  if (typeof prefixe !== 'string' || typeof suffixe !== 'string') return null;
  if (nombreChiffres !== null && typeof nombreChiffres !== 'number') return null;
  if (typeof description !== 'string') return null;

  return { prefixe, suffixe, nombreChiffres, description };
}
