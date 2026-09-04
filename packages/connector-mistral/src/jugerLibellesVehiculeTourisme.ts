import type { MistralClient } from './client.js';

export interface JugementVehiculeTourisme {
  ledgerEntryId: number;
  estTourisme: boolean;
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
}

// Juge si le libellé d'une écriture d'achat d'immobilisation sur le
// compte véhicule (2182, matériel de transport) désigne un véhicule de
// TOURISME plutôt qu'utilitaire (10/08, demande de Rami — remplace
// l'ancien signalement systématique dès qu'un véhicule de tourisme
// existait quelque part dans le parc, bien trop large). Rami : le
// libellé indique presque toujours le type de véhicule à l'achat, et il
// juge cette détection suffisamment fiable pour l'IA quand l'info est
// bien présente dans le libellé.
//
// PRINCIPE DE PRUDENCE, comme pour jugerLibellesHotel : jamais estTourisme
// à true sans un signal réel dans le libellé — l'absence d'indice doit
// donner false, jamais deviné par défaut. Un comptable confirme ou
// rejette toujours le résultat, ce jugement ne décide jamais seul.
export async function jugerLibellesVehiculeTourisme(
  client: MistralClient,
  ecritures: { ledgerEntryId: number; libelle: string | null }[]
): Promise<JugementVehiculeTourisme[]> {
  if (ecritures.length === 0) return [];

  const systemPrompt =
    `Tu es un assistant qui aide à repérer, parmi des libellés d'écritures ` +
    `comptables françaises d'achat de véhicule (compte 2182, matériel de ` +
    `transport), lesquelles désignent un véhicule de TOURISME (voiture ` +
    `particulière : berline, citadine, SUV, break, monospace, marques et ` +
    `modèles courants de voitures particulières...) plutôt qu'un véhicule ` +
    `UTILITAIRE (fourgon, camionnette, utilitaire, camion, benne, plateau, ` +
    `fourgonnette...). Réponds estTourisme: false si le libellé indique ` +
    `clairement un utilitaire, OU si tu hésites, OU si le libellé ne donne ` +
    `aucune indication exploitable sur le type de véhicule — un faux ` +
    `positif serait plus gênant qu'un faux négatif ici (l'humain vérifiera ` +
    `de toute façon, mais un faux positif pourrait laisser croire à tort ` +
    `qu'une déduction de TVA était une erreur). Tu ne prends aucune ` +
    `décision définitive. Réponds uniquement en JSON, sans texte hors du JSON.`;

  const ecrituresTexte = ecritures
    .map((e) => `- id ${e.ledgerEntryId} : "${e.libelle ?? '(libellé vide)'}"`)
    .join('\n');

  const userPrompt =
    `Écritures à examiner :\n${ecrituresTexte}\n\n` +
    `Réponds avec ce format JSON exact : ` +
    `{"jugements": [{"ledgerEntryId": ..., "estTourisme": true|false, ` +
    `"confiance": "haute|moyenne|basse", "justification": "une phrase courte"}]}. ` +
    `Une entrée par écriture listée ci-dessus, dans le même ordre.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireJugements(
    brut,
    ecritures.map((e) => e.ledgerEntryId)
  );
}

function validerEtExtraireJugements(brut: unknown, idsAttendus: number[]): JugementVehiculeTourisme[] {
  if (typeof brut !== 'object' || brut === null || !('jugements' in brut)) return [];
  const jugements = (brut as { jugements: unknown }).jugements;
  if (!Array.isArray(jugements)) return [];

  const idsConnus = new Set(idsAttendus);
  const resultat: JugementVehiculeTourisme[] = [];

  for (const item of jugements) {
    if (typeof item !== 'object' || item === null) continue;
    const { ledgerEntryId, estTourisme, confiance, justification } = item as Record<string, unknown>;

    if (typeof ledgerEntryId !== 'number' || !idsConnus.has(ledgerEntryId)) continue;
    if (typeof estTourisme !== 'boolean') continue;
    if (confiance !== 'haute' && confiance !== 'moyenne' && confiance !== 'basse') continue;

    resultat.push({
      ledgerEntryId,
      estTourisme,
      confiance,
      justification: typeof justification === 'string' ? justification : '',
    });
  }

  return resultat;
}
