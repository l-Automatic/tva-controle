import type { MistralClient } from './client.js';

export interface JugementVehiculeIdentifie {
  ledgerEntryId: number;
  vehiculeIdentifie: boolean;
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
}

// Juge si le libellé d'une écriture d'entretien/réparation ou de
// location/crédit-bail (compte confirmé comptesEntretienVehicule ou
// comptesLocationVehicule) identifie un véhicule précis — immatriculation,
// marque, modèle (ex: "Renault Trafic", "Trafic", une plaque) (10/08,
// demande de Rami). Ne juge PAS si c'est un véhicule de tourisme ou
// utilitaire — cette question est déjà tranchée séparément par la
// composition de la flotte (100% tourisme, jamais mixte, cf.
// controles-module4/index.ts) ; ici, uniquement "un véhicule est-il
// identifiable dans ce libellé".
//
// PRINCIPE DE PRUDENCE, comme pour jugerLibellesHotel/VehiculeTourisme :
// vehiculeIdentifie à true seulement avec un vrai signal dans le libellé,
// jamais deviné par défaut. Un comptable confirme ou rejette toujours le
// résultat, ce jugement ne décide jamais seul.
export async function jugerVehiculeIdentifieDansLibelle(
  client: MistralClient,
  ecritures: { ledgerEntryId: number; libelle: string | null }[]
): Promise<JugementVehiculeIdentifie[]> {
  if (ecritures.length === 0) return [];

  const systemPrompt =
    `Tu es un assistant qui aide à repérer, parmi des libellés d'écritures ` +
    `comptables françaises d'entretien, de réparation ou de location de ` +
    `véhicule, lesquelles identifient un véhicule PRÉCIS (une ` +
    `immatriculation, une marque et/ou un modèle comme "Renault Trafic", ` +
    `"Trafic", "Peugeot 308"...). Réponds vehiculeIdentifie: false si le ` +
    `libellé ne donne aucune indication exploitable sur quel véhicule est ` +
    `concerné — un faux positif serait plus gênant qu'un faux négatif ici ` +
    `(l'humain vérifiera de toute façon). Tu ne juges JAMAIS si le véhicule ` +
    `est de tourisme ou utilitaire, uniquement si un véhicule est ` +
    `identifiable dans le texte. Tu ne prends aucune décision définitive. ` +
    `Réponds uniquement en JSON, sans texte hors du JSON.`;

  const ecrituresTexte = ecritures
    .map((e) => `- id ${e.ledgerEntryId} : "${e.libelle ?? '(libellé vide)'}"`)
    .join('\n');

  const userPrompt =
    `Écritures à examiner :\n${ecrituresTexte}\n\n` +
    `Réponds avec ce format JSON exact : ` +
    `{"jugements": [{"ledgerEntryId": ..., "vehiculeIdentifie": true|false, ` +
    `"confiance": "haute|moyenne|basse", "justification": "une phrase courte"}]}. ` +
    `Une entrée par écriture listée ci-dessus, dans le même ordre.`;

  const brut = await client.completionJson(systemPrompt, userPrompt);

  return validerEtExtraireJugements(
    brut,
    ecritures.map((e) => e.ledgerEntryId)
  );
}

function validerEtExtraireJugements(brut: unknown, idsAttendus: number[]): JugementVehiculeIdentifie[] {
  if (typeof brut !== 'object' || brut === null || !('jugements' in brut)) return [];
  const jugements = (brut as { jugements: unknown }).jugements;
  if (!Array.isArray(jugements)) return [];

  const idsConnus = new Set(idsAttendus);
  const resultat: JugementVehiculeIdentifie[] = [];

  for (const item of jugements) {
    if (typeof item !== 'object' || item === null) continue;
    const { ledgerEntryId, vehiculeIdentifie, confiance, justification } = item as Record<string, unknown>;

    if (typeof ledgerEntryId !== 'number' || !idsConnus.has(ledgerEntryId)) continue;
    if (typeof vehiculeIdentifie !== 'boolean') continue;
    if (confiance !== 'haute' && confiance !== 'moyenne' && confiance !== 'basse') continue;

    resultat.push({
      ledgerEntryId,
      vehiculeIdentifie,
      confiance,
      justification: typeof justification === 'string' ? justification : '',
    });
  }

  return resultat;
}
