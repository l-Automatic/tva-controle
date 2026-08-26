import type { Pool } from 'pg';
import type { PennylaneClient } from '@tva-controle/connector-pennylane';
import { decouvrirComptesParPrefixe, fetchLignesParCompte, fetchPieceNumbers } from '@tva-controle/connector-pennylane';
import { MistralClient, decouvrirMotifNumerotation, type MotifNumerotation } from '@tva-controle/connector-mistral';
import { avecContexteCabinet } from './db/pool.js';
import { parametreCabinetValeur } from './db/readRepository.js';
import { ajouterConventionManuelle } from './db/writeRepository.js';

export class ClefMistralAbsenteError extends Error {
  constructor() {
    super("Aucune clé API Mistral configurée pour ce cabinet — impossible d'analyser le motif de numérotation.");
    this.name = 'ClefMistralAbsenteError';
  }
}

export interface ParametresAnalyseMotifNumerotation {
  cabinetId: string;
  dossierId: string;
  client: PennylaneClient; // déjà construit — cohérent avec executerCycleTva, testable via fetchImpl injecté à la construction
  periodeDebut: string; // borné à l'exercice en cours (pas tout l'historique), décision explicite
  periodeFin: string;
  utilisateurId: string;
}

// Déclenchée MANUELLEMENT (bouton dédié côté interface), jamais
// automatiquement à chaque cycle — décision de Rami (10/08) : un
// changement de format de numérotation est trop rare pour justifier plus
// qu'un déclenchement manuel quand le collaborateur sait que ça a changé.
//
// Distincte du pipeline de cycle normal : celui-ci se contente d'APPLIQUER
// un motif déjà confirmé (detecterTrousNumerotation, aucun appel réseau) —
// cette fonction-ci sert uniquement à PROPOSER un nouveau motif candidate,
// jamais à calculer de TVA.
export async function analyserMotifNumerotationFacture(
  pool: Pool,
  params: ParametresAnalyseMotifNumerotation
): Promise<{ motifPropose: MotifNumerotation | null }> {
  const mistralApiKey = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    parametreCabinetValeur(client, params.cabinetId, 'mistral_api_key')
  );
  if (typeof mistralApiKey !== 'string' || mistralApiKey.length === 0) {
    throw new ClefMistralAbsenteError();
  }

  const pennylaneClient = params.client;
  const comptesCollecte = await decouvrirComptesParPrefixe(pennylaneClient, '44571');
  if (comptesCollecte.length === 0) {
    return { motifPropose: null };
  }

  const lignes = await fetchLignesParCompte(pennylaneClient, {
    compteIds: comptesCollecte.map((c) => c.id),
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  // Le vrai numéro de facture vit sur l'écriture (piece_number), jamais sur
  // le libellé d'une ligne — confirmé par Rami (10/08) pour les ventes
  // spécifiquement, systématiquement saisi avec le vrai numéro.
  const ledgerEntryIds = [...new Set(lignes.map((l) => l.ledgerEntryId))];
  const pieceNumbers = await fetchPieceNumbers(pennylaneClient, ledgerEntryIds);
  const numerosExemples = [...new Set([...pieceNumbers.values()].filter((n): n is string => n !== null))];
  if (numerosExemples.length === 0) {
    return { motifPropose: null };
  }

  const mistralClient = new MistralClient({ apiKey: mistralApiKey });
  const motifPropose = await decouvrirMotifNumerotation(mistralClient, numerosExemples);

  if (motifPropose) {
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      ajouterConventionManuelle(client, params.dossierId, params.utilisateurId, 'motif_numerotation_facture', motifPropose)
    );
  }

  return { motifPropose };
}
