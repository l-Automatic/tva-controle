import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { detecterCadeauClientSeuilDepasse } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionListe } from './db/dossierRepository.js';
import { enregistrerAnomaliesPartielles } from './db/writeRepository.js';

// Vérification ciblée et légère de cadeau_client_seuil_depasse (10/08) —
// "Vérifier à nouveau", un seul bouton, pas de qualification préalable :
// vraie erreur certaine (montant réel dépassé + TVA réellement déduite),
// même famille que les autres contrôles déterministes de cette revue.
// Aucun ajustement du calcul — bloque simplement la validation.
export interface ParametresVerificationCadeauClient {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function verifierCadeauClientLegere(
  pool: Pool,
  params: ParametresVerificationCadeauClient
): Promise<{ anomaliesOuvertes: number }> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const comptesCadeaux = conventionListe(contexteDossier, 'comptes_cadeaux') ?? [];

  const balance = await fetchTrialBalance(params.client, {
    dossierId: params.dossierId,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });
  const comptesTva = filterComptesParPrefixe(balance, ['445'])
    .filter((c) => c.debit !== 0 || c.credit !== 0)
    .map((c) => c.numeroCompte);
  const ecritures = await fetchEcrituresTvaCompletes(params.client, {
    comptesTva,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  const anomaliesFraiches = detecterCadeauClientSeuilDepasse(ecritures, { comptesCadeaux });

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomaliesPartielles(
      client,
      params.dossierId,
      params.periodeDebut,
      ['cadeau_client_seuil_depasse'],
      anomaliesFraiches
    )
  );

  return { anomaliesOuvertes: anomaliesFraiches.length };
}
