import type { Pool } from 'pg';
import { PennylaneClient, fetchEcrituresTvaCompletes } from '@tva-controle/connector-pennylane';
import {
  executerPreControles,
  determinerExigibiliteTva,
  determinerDeductibiliteCarburant,
  detecterImmobilisationManquee,
} from '@tva-controle/controles-module4';
import { calculerTva, type ResultatCalculTva } from '@tva-controle/calcul-module7';
import type { Anomalie } from '@tva-controle/core';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur, conventionListe } from './db/dossierRepository.js';
import { enregistrerAnomalies, enregistrerCalcul } from './db/writeRepository.js';

export interface ParametresCycleTva {
  cabinetId: string;
  dossierId: string;
  periodeDebut: string;
  periodeFin: string;
  client: PennylaneClient;
  // Simplification v1, non encore stockée en base (pas de convention dédiée
  // à ce jour) — passée explicitement plutôt que devinée :
  comptesTva: string[];
  // Dérivés de conventions_dossier (comptes_vente_service,
  // comptes_charge_service, comptes_equipement, comptes_carburant) si non
  // fournis ici. Un override reste possible — utile en test, ou pour un
  // dossier pas encore onboardé où rien n'est confirmé en base.
  comptesVenteServiceOverride?: string[];
  comptesChargeServiceOverride?: string[];
  comptesEquipementOverride?: string[];
  comptesCarburantOverride?: string[];
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

  // Dérivés de la mémoire de dossier — [] si le dossier n'a encore aucune
  // convention confirmée pour ce point (ex: pas encore onboardé). Un tableau
  // vide désactive silencieusement la classification "service" correspondante
  // (tout est alors traité comme "bien"/exigible par défaut) plutôt que de
  // faire échouer le cycle — cohérent avec le comportement déjà en place
  // avant que ces contrôles existent.
  const comptesVenteService =
    params.comptesVenteServiceOverride ?? conventionListe(contexteDossier, 'comptes_vente_service') ?? [];
  const comptesChargeService =
    params.comptesChargeServiceOverride ?? conventionListe(contexteDossier, 'comptes_charge_service') ?? [];
  const comptesEquipement =
    params.comptesEquipementOverride ?? conventionListe(contexteDossier, 'comptes_equipement') ?? [];
  const comptesCarburant =
    params.comptesCarburantOverride ?? conventionListe(contexteDossier, 'comptes_carburant') ?? [];

  const anomaliesPreControles = executerPreControles(ecritures, {
    contexteDossier,
    ...(compteAutoliquidationDue !== undefined ? { compteAutoliquidationDue } : {}),
    ...(compteAutoliquidationDeductible !== undefined ? { compteAutoliquidationDeductible } : {}),
  });

  const { statuts: statutsExigibilite, anomalies: anomaliesExigibilite } = determinerExigibiliteTva(
    ecritures,
    { comptesVenteService, comptesChargeService }
  );

  const { statuts: statutsCarburant, anomalies: anomaliesCarburant } = determinerDeductibiliteCarburant(
    ecritures,
    { comptesCarburant },
    contexteDossier
  );

  const anomaliesImmobilisation = detecterImmobilisationManquee(ecritures, { comptesEquipement });

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
