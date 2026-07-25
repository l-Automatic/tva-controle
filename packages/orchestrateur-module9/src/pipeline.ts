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
  | { statut: 'calcule'; anomalies: Anomalie[]; resultat: ResultatCalculTva };

// Enchaîne : charge le contexte dossier (Module 2) -> récupère les écritures
// (Module 1) -> exécute tous les contrôles (Module 4) -> s'arrête si une
// anomalie bloquante existe -> sinon calcule (Module 7).
//
// Comme rien ne marque encore une anomalie "résolue" en base (Module 6 pas
// construit), TOUTE anomalie bloquante arrête systématiquement le calcul —
// c'est le comportement attendu de cette version, pas une limitation à
// corriger dans ce module précis.
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

  if (toutesAnomalies.some((a) => a.gravite === 'bloquant')) {
    return { statut: 'bloque', anomalies: toutesAnomalies };
  }

  const resultat = calculerTva(ecritures, toutesAnomalies, statutsExigibilite, statutsCarburant, {
    contexteDossier,
    ...(compteAutoliquidationDue !== undefined ? { compteAutoliquidationDue } : {}),
    ...(compteAutoliquidationDeductible !== undefined ? { compteAutoliquidationDeductible } : {}),
  });

  return { statut: 'calcule', anomalies: toutesAnomalies, resultat };
}
