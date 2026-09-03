import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import { fetchTrialBalance, filterComptesParPrefixe, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import { determinerDeductibiliteCarburant } from '@tva-controle/controles-module4';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionListe } from './db/dossierRepository.js';

// Vérification légère du parc de véhicules (10/08, demande de Rami) —
// même principe que la catégorisation bien/service et le rapprochement
// des paiements achats : garanti renseigné AVANT qu'un cycle ne parte, dès
// qu'une écriture touche un compte carburant, jamais rattrapé après coup
// (sans quoi la déductibilité 80%/100% resterait indéterminée en
// silence). Une fois le parc renseigné une première fois, cette
// vérification ne bloque plus rien pour les cycles suivants — le parc
// est une configuration dossier, pas une décision par écriture.
export interface ParametresVerificationParc {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

// true = au moins une anomalie parc_vehicules_non_renseigne serait levée
// sur cette période — le cycle doit être bloqué tant que ce n'est pas
// renseigné.
export async function verifierParcVehicules(pool: Pool, params: ParametresVerificationParc): Promise<boolean> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const comptesCarburant = conventionListe(contexteDossier, 'comptes_carburant') ?? [];
  if (comptesCarburant.length === 0) return false; // aucun compte carburant configuré, rien à vérifier

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

  const { anomalies } = determinerDeductibiliteCarburant(ecritures, { comptesCarburant }, contexteDossier);
  return anomalies.some((a) => a.type === 'parc_vehicules_non_renseigne');
}
