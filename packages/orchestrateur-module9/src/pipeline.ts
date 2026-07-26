import type { Pool } from 'pg';
import { PennylaneClient, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import {
  executerPreControles,
  determinerExigibiliteTva,
  determinerDeductibiliteCarburant,
  detecterImmobilisationManquee,
  type ConfigExigibiliteTva,
  type ConfigCarburantVehicule,
} from '@tva-controle/controles-module4';
import { calculerTva, type ResultatCalculTva } from '@tva-controle/calcul-module7';
import type { Anomalie } from '@tva-controle/core';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur } from './db/dossierRepository.js';
import { enregistrerAnomalies, enregistrerCalcul } from './db/writeRepository.js';

export interface ParametresCycleTva {
  cabinetId: string;
  dossierId: string;
  periodeDebut: string;
  periodeFin: string;
  client: PennylaneClient;
  // Simplifications v1, non encore stockées en base (pas de table/convention
  // dédiée à ce jour) — passées explicitement plutôt que devinées :
  comptesTva: string[];
  configExigibilite: ConfigExigibiliteTva;
  configCarburant: ConfigCarburantVehicule;
  comptesEquipement: string[];
}

export type ResultatCycleTva =
  | { statut: 'bloque'; anomalies: Anomalie[] }
  | { statut: 'calcule'; anomalies: Anomalie[]; resultat: ResultatCalculTva; calculId: string };

// Enchaîne : charge le contexte dossier (Module 2) -> récupère les écritures
// (Module 1) -> exécute tous les contrôles (Module 4) -> persiste les
// anomalies -> s'arrête si une anomalie bloquante existe -> sinon calcule
// (Module 7) et persiste le résultat.
//
// Les anomalies sont TOUJOURS persistées, même en cas de blocage — c'est
// justement ce qui permet à Module 6 (validation humaine) de les voir et de
// les traiter. Comme rien ne marque encore une anomalie "résolue" avant le
// prochain cycle, relancer executerCycleTva sur la même période sans avoir
// traité les anomalies precédentes les insère à nouveau (pas de
// déduplication en v1 — limitation connue, pas un oubli).
//
// La persistance se fait dans des transactions séparées de la lecture du
// contexte et de l'appel réseau Pennylane, pour ne jamais garder une
// transaction Postgres ouverte pendant une opération lente/externe.
export async function executerCycleTva(
  pool: Pool,
  params: ParametresCycleTva
): Promise<ResultatCycleTva> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );

  const ecritures = await fetchEcrituresTvaCompletes(params.client, {
    comptesTva: params.comptesTva,
    periodeDebut: params.periodeDebut,
    periodeFin: params.periodeFin,
  });

  const compteAutoliquidationDue = conventionValeur(contexteDossier, 'compte_tva_due_autoliquidee');
  const compteAutoliquidationDeductible = conventionValeur(
    contexteDossier,
    'compte_tva_deductible_autoliquidee'
  );

  const anomaliesPreControles = executerPreControles(ecritures, {
    contexteDossier,
    ...(compteAutoliquidationDue !== undefined ? { compteAutoliquidationDue } : {}),
    ...(compteAutoliquidationDeductible !== undefined ? { compteAutoliquidationDeductible } : {}),
  });

  const { statuts: statutsExigibilite, anomalies: anomaliesExigibilite } = determinerExigibiliteTva(
    ecritures,
    params.configExigibilite
  );

  const { statuts: statutsCarburant, anomalies: anomaliesCarburant } = determinerDeductibiliteCarburant(
    ecritures,
    params.configCarburant,
    contexteDossier
  );

  const anomaliesImmobilisation = detecterImmobilisationManquee(ecritures, {
    comptesEquipement: params.comptesEquipement,
  });

  const toutesAnomalies: Anomalie[] = [
    ...anomaliesPreControles,
    ...anomaliesExigibilite,
    ...anomaliesCarburant,
    ...anomaliesImmobilisation,
  ];

  await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerAnomalies(client, params.dossierId, params.periodeDebut, toutesAnomalies)
  );

  if (toutesAnomalies.some((a) => a.gravite === 'bloquant')) {
    return { statut: 'bloque', anomalies: toutesAnomalies };
  }

  const resultat = calculerTva(ecritures, toutesAnomalies, statutsExigibilite, statutsCarburant, {
    contexteDossier,
    ...(compteAutoliquidationDue !== undefined ? { compteAutoliquidationDue } : {}),
    ...(compteAutoliquidationDeductible !== undefined ? { compteAutoliquidationDeductible } : {}),
  });

  const calculId = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    enregistrerCalcul(client, params.dossierId, params.periodeDebut, params.periodeFin, resultat)
  );

  return { statut: 'calcule', anomalies: toutesAnomalies, resultat, calculId };
}
