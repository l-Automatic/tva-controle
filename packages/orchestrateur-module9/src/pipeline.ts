import type { Pool } from 'pg';
import {
  PennylaneClient,
  fetchEcrituresTvaCompletes,
  fetchTrialBalance,
  filterComptesParPrefixe,
  fetchLignesParCompte,
  decouvrirComptesParPrefixe,
} from '@tva-controle/connector-pennylane';
import {
  executerPreControles,
  determinerExigibiliteTva,
  determinerDeductibiliteCarburant,
  detecterImmobilisationManquee,
  verifierDeductibiliteVehiculeTourisme,
  detecterEncaissementsNonAffectes,
  verifierNouveauxTiers,
  detecterEncaissementsClientAAffecter,
  identifierComptesACategoriser,
  type CompteACategoriser,
  identifierComptesSansTauxAssigne,
  identifierComptesClientSansTaux,
  type CompteSansTauxAssigne,
  type CompteClientSansTauxAssigne,
} from '@tva-controle/controles-module4';
import { calculerTva, integrerRegularisations, type ResultatCalculTva } from '@tva-controle/calcul-module7';
import { analyserTauxHistorique, analyserTauxHistoriqueParTiers } from '@tva-controle/onboarding-module3';
import type { Anomalie } from '@tva-controle/core';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, conventionValeur, conventionListe } from './db/dossierRepository.js';
import {
  enregistrerAnomalies,
  enregistrerCalcul,
  enregistrerEvenementAudit,
  synchroniserTiersReference,
  enregistrerPropositionsTaux,
  enregistrerPropositionsTauxTiers,
} from './db/writeRepository.js';
import {
  listerLedgerEntryIdsQualifies,
  listerRegularisationsAIntegrer,
  listerAnomaliesTraiteesParTypeEtPiece,
  listerTauxAssignes,
  parametreDossierValeur,
} from './db/readRepository.js';

export interface ParametresCycleTva {
  cabinetId: string;
  dossierId: string;
  periodeDebut: string;
  periodeFin: string;
  client: PennylaneClient;
  // Découvert automatiquement (comptes 445* ayant un vrai mouvement sur la
  // période, via la balance) si non fourni — override possible pour les
  // tests ou un besoin ponctuel de restreindre le périmètre.
  //
  // Historique : une première version découvrait via la liste brute des
  // comptes (start_with '445'), mais Pennylane active par défaut des
  // dizaines de sous-comptes TVA par pays jamais utilisés (ex: "TVA
  // collectée Portugal à 16%") — même avec enabled=true. Résultat en test
  // réel : un dossier avec de vraies écritures a produit un calcul vide.
  // La balance (déjà scoppée à la période) ne remonte que les comptes avec
  // un solde réellement mouvementé, éliminant ces faux positifs à la racine
  // plutôt que par une liste d'exclusions fragile.
  comptesTvaOverride?: string[];
  // Dérivés de conventions_dossier (comptes_vente_service,
  // comptes_charge_service, comptes_equipement, comptes_carburant) si non
  // fournis ici. Un override reste possible — utile en test, ou pour un
  // dossier pas encore onboardé où rien n'est confirmé en base.
  comptesVenteServiceOverride?: string[];
  comptesChargeServiceOverride?: string[];
  comptesEquipementOverride?: string[];
  comptesCarburantOverride?: string[];
  // Comptes d'attente (471 par défaut) sur lesquels chercher des encaissements
  // non identifiés — préfixes, pas numéros exacts (comme comptesTva), car un
  // dossier peut subdiviser en plusieurs sous-comptes 471x.
  comptesAttenteOverride?: string[];
  // Préfixe des comptes clients (411 par défaut) sur lesquels chercher des
  // encaissements non lettrés à régulariser (chantier B) — même logique de
  // préfixe que comptesAttenteOverride, un dossier peut avoir des
  // sous-comptes 411xxx par client.
  comptesClientOverride?: string[];
}

export type ResultatCycleTva =
  | {
      statut: 'bloque';
      anomalies: Anomalie[];
      comptesACategoriser: CompteACategoriser[];
      comptesSansTauxAssigne: CompteSansTauxAssigne[];
      comptesClientSansTaux: CompteClientSansTauxAssigne[];
    }
  | {
      statut: 'calcule';
      anomalies: Anomalie[];
      resultat: ResultatCalculTva;
      calculId: string;
      comptesACategoriser: CompteACategoriser[];
      comptesSansTauxAssigne: CompteSansTauxAssigne[];
      comptesClientSansTaux: CompteClientSansTauxAssigne[];
    };

// Enchaîne : charge le contexte dossier (Module 2) -> récupère les écritures
// (Module 1) -> exécute tous les contrôles (Module 4) -> persiste les
// anomalies -> s'arrête si une anomalie bloquante existe -> sinon calcule
// (Module 7) et persiste le résultat.
//
// Les anomalies sont TOUJOURS persistées, même en cas de blocage — c'est
// justement ce qui permet à Module 6 (validation humaine) de les voir et de
// les traiter. Relancer executerCycleTva sur la même période marque les
// anciennes anomalies encore 'ouvert' comme 'obsolete' avant d'insérer le
// nouveau lot (enregistrerAnomalies) — les anomalies déjà traitées
// ('resolu'/'justifie') ne sont, elles, jamais touchées par une relance.
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

  const comptesTva =
    params.comptesTvaOverride ??
    (await (async () => {
      const balance = await fetchTrialBalance(params.client, {
        dossierId: params.dossierId,
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
      });
      return filterComptesParPrefixe(balance, ['445'])
        .filter((c) => c.debit !== 0 || c.credit !== 0)
        .map((c) => c.numeroCompte);
    })());

  const ecritures = await fetchEcrituresTvaCompletes(params.client, {
    comptesTva,
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
  const comptesAttentePrefixes =
    params.comptesAttenteOverride ?? conventionListe(contexteDossier, 'comptes_attente') ?? ['471'];

  // Détection déterministe pour le popup de catégorisation (08/08) — ne
  // dépend que des 4 conventions déjà connues, calculée une fois qu'elles
  // le sont toutes. Pas de présélection IA ici, cf. comptesACategoriser.ts.
  const comptesACategoriser = identifierComptesACategoriser(ecritures, {
    comptesVenteService,
    comptesChargeService,
    comptesEquipement,
    comptesCarburant,
  });

  // Suggestions pour l'onglet "Taux assigné" (09/08) — comptes mouvementés
  // sans taux encore assigné, produit/charge et client.
  const tauxAssignesExistants = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerTauxAssignes(client, params.dossierId)
  );
  const comptesSansTauxAssigne = identifierComptesSansTauxAssigne(
    ecritures,
    tauxAssignesExistants.map((t) => t.compte)
  );
  // contexteDossier.tauxHistorique contient déjà les taux clients confirmés
  // (fusionnés avec ceux de compte produit/charge dans chargerContexteDossier,
  // cf. dossierRepository.ts) — les comptes 445xxx y figurent aussi
  // (collecte), donc on exclut ce préfixe pour ne garder que les comptes
  // client (411xxx typiquement) déjà connus.
  const comptesClientConnusAvecTaux = contexteDossier.tauxHistorique
    .map((t) => t.compteOuTiers)
    .filter((c) => !c.startsWith('445'));
  const comptesClientSansTaux = identifierComptesClientSansTaux(ecritures, comptesClientConnusAvecTaux);

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
  const anomaliesVehiculeTourisme = verifierDeductibiliteVehiculeTourisme(ecritures, contexteDossier);

  // Encaissements en compte(s) d'attente non identifiés (cf. compte 471) —
  // fetch séparé de fetchEcrituresTvaCompletes ci-dessus : ces lignes n'ont
  // par définition aucune ligne TVA associée (c'est justement le problème),
  // donc invisibles pour un fetch ancré sur les comptes 445*.
  const comptesAttente = (
    await Promise.all(comptesAttentePrefixes.map((prefixe) => decouvrirComptesParPrefixe(params.client, prefixe)))
  ).flat();
  const lignesAttente =
    comptesAttente.length > 0
      ? await fetchLignesParCompte(params.client, {
          compteIds: comptesAttente.map((c) => c.id),
          periodeDebut: params.periodeDebut,
          periodeFin: params.periodeFin,
        })
      : [];

  // Filtre les pièces déjà qualifiées lors d'un cycle précédent : sinon,
  // comme la détection relit les mêmes lignes Pennylane à chaque relance
  // (elle ne sait rien de nos décisions passées), un encaissement déjà
  // qualifié re-bloquerait indéfiniment tout nouveau cycle sur la période.
  const ledgerEntryIdsQualifies = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerLedgerEntryIdsQualifies(client, params.dossierId)
  );
  const anomaliesEncaissements = detecterEncaissementsNonAffectes(lignesAttente).filter(
    (a) => !ledgerEntryIdsQualifies.has(a.ledgerEntryId)
  );

  // Chantier B : encaissements sur un compte CLIENT précis (411xxx), non
  // lettrés — distinct du 471 (compte d'attente générique) : ici chaque
  // compte a potentiellement son propre historique de taux. Contrairement
  // au 471, pas de blocage/qualification préalable : un taux par défaut
  // (historique du client si connu, sinon 20% par prudence) est appliqué
  // directement, cf. detecterEncaissementsClientAAffecter.
  const comptesClientPrefixes = params.comptesClientOverride ?? ['411'];
  const comptesClient = (
    await Promise.all(comptesClientPrefixes.map((prefixe) => decouvrirComptesParPrefixe(params.client, prefixe)))
  ).flat();
  const lignesClient =
    comptesClient.length > 0
      ? await fetchLignesParCompte(params.client, {
          compteIds: comptesClient.map((c) => c.id),
          periodeDebut: params.periodeDebut,
          periodeFin: params.periodeFin,
        })
      : [];
  // Régime TVA sur encaissement (09/08) : 'service' par défaut si non
  // paramétré (comportement historique, rétrocompatible avec les dossiers
  // déjà en test). Un dossier vendant des biens (ou fonctionnant en caisse
  // comptant) doit être explicitement basculé sur 'bien' dans les
  // paramètres du dossier, sinon les acomptes sur biens seraient à tort
  // soumis à la règle "collecte à l'encaissement" (art. 269-2-a CGI : pas
  // de TVA sur un acompte de bien).
  const regimeTvaEncaissementBrut = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    parametreDossierValeur(client, params.dossierId, 'regime_tva_encaissement')
  );
  const regimeTvaEncaissement: 'service' | 'bien' | 'mixte' =
    regimeTvaEncaissementBrut === 'bien' || regimeTvaEncaissementBrut === 'mixte' ? regimeTvaEncaissementBrut : 'service';
  const { regularisations: regularisationsClient, anomalies: anomaliesClient } = detecterEncaissementsClientAAffecter(
    lignesClient,
    contexteDossier,
    regimeTvaEncaissement
  );

  const { statuts: statutsTiers, anomalies: anomaliesTiers } = verifierNouveauxTiers(ecritures, contexteDossier);

  const toutesAnomaliesBrutes: Anomalie[] = [
    ...anomaliesPreControles,
    ...anomaliesExigibilite,
    ...anomaliesCarburant,
    ...anomaliesImmobilisation,
    ...anomaliesVehiculeTourisme,
    ...anomaliesEncaissements,
    ...anomaliesClient,
    ...anomaliesTiers,
  ];

  // Filtre générique anti-doublon (09/08) : une anomalie déjà résolue ou
  // justifiée pour cette même pièce ne doit pas réapparaître à la relance
  // du cycle, quel que soit son type — cf. listerAnomaliesTraiteesParTypeEtPiece.
  // La détection elle-même reste stateless et relit les mêmes écritures à
  // chaque cycle (comme avant), c'est uniquement l'AFFICHAGE/persistance
  // qui est filtré ici, jamais le calcul lui-même (une régularisation déjà
  // intégrée au calcul, ex: chantier B, continue de s'appliquer).
  const anomaliesTraitees = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerAnomaliesTraiteesParTypeEtPiece(client, params.dossierId)
  );
  const toutesAnomalies = toutesAnomaliesBrutes.filter(
    (a) => !anomaliesTraitees.has(`${a.type}:${a.ledgerEntryId}`)
  );

  // enregistrerAnomalies retourne les lignes réellement insérées (avec leur
  // id généré par Postgres) : nécessaire pour référencer les anomalies
  // bloquantes par id dans l'événement d'audit, plutôt qu'un simple décompte.
  const anomaliesInserees = await avecContexteCabinet(pool, params.cabinetId, async (client) => {
    const inserees = await enregistrerAnomalies(client, params.dossierId, params.periodeDebut, toutesAnomalies);

    // Même transaction, volontairement : la mémoire de confiance des tiers
    // avance dès que le contrôle a tourné, indépendamment du fait que le
    // cycle bloque ensuite pour une autre raison (ex: 471 non qualifié) —
    // ce n'est pas lié, pas de raison d'attendre un calcul réussi pour ça.
    await synchroniserTiersReference(client, params.dossierId, statutsTiers, params.periodeFin);

    // Propositions de taux historique (compte produit/charge ET compte
    // tiers) — recalculées à chaque cycle sur les écritures déjà fetchées,
    // mais enregistrerPropositionsTaux(Tiers) ne propose qu'une fois par
    // compte (garde-fou anti-doublon) : ça ne fait rien de plus au-delà du
    // premier cycle pour un compte déjà proposé/tranché. Persisté ici,
    // affiché et confirmé/rejeté via le panneau "Taux historique" déjà
    // existant côté frontend — pas de nouvelle popup nécessaire.
    await enregistrerPropositionsTaux(client, params.dossierId, analyserTauxHistorique(ecritures));
    await enregistrerPropositionsTauxTiers(client, params.dossierId, analyserTauxHistoriqueParTiers(ecritures));

    const parGravite: Record<string, number> = {};
    for (const a of inserees) {
      parGravite[a.gravite] = (parGravite[a.gravite] ?? 0) + 1;
    }

    await enregistrerEvenementAudit(client, {
      dossierId: params.dossierId,
      typeEvenement: 'anomalies_detectees',
      moduleSource: 'module4_controles',
      acteur: 'systeme',
      details: {
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
        total: inserees.length,
        parGravite,
        anomalieIds: inserees.map((a) => a.id),
      },
    });

    return inserees;
  });

  const anomaliesBloquantes = anomaliesInserees.filter((a) => a.gravite === 'bloquant');
  if (anomaliesBloquantes.length > 0) {
    await avecContexteCabinet(pool, params.cabinetId, (client) =>
      enregistrerEvenementAudit(client, {
        dossierId: params.dossierId,
        typeEvenement: 'calcul_bloque',
        moduleSource: 'module9_orchestrateur',
        acteur: 'systeme',
        details: {
          periodeDebut: params.periodeDebut,
          periodeFin: params.periodeFin,
          anomalieIds: anomaliesBloquantes.map((a) => a.id),
        },
      })
    );
    return {
      statut: 'bloque',
      anomalies: toutesAnomalies,
      comptesACategoriser,
      comptesSansTauxAssigne,
      comptesClientSansTaux,
    };
  }

  if (process.env.DEBUG_CYCLE) {
    console.error(`[DEBUG_CYCLE] comptesTva découverts : ${JSON.stringify(comptesTva)}`);
    console.error(`[DEBUG_CYCLE] ecritures.length = ${ecritures.length}`);
    console.error(
      `[DEBUG_CYCLE] comptes TVA vus dans ecritures : ${JSON.stringify(
        [...new Set(ecritures.map((e) => e.ligneTva.compte))]
      )}`
    );
    console.error(
      `[DEBUG_CYCLE] statutsExigibilite : ${JSON.stringify(
        statutsExigibilite.map((s) => ({ compte: s.compte, exigible: s.exigible, motif: s.motif }))
      )}`
    );
    console.error(
      `[DEBUG_CYCLE] statutsCarburant : ${JSON.stringify(statutsCarburant)}`
    );
    console.error(
      `[DEBUG_CYCLE] toutesAnomalies (type/compte) : ${JSON.stringify(
        toutesAnomalies.map((a) => ({ type: a.type, compte: a.compte, gravite: a.gravite }))
      )}`
    );
  }

  const resultatBrut = calculerTva(ecritures, toutesAnomalies, statutsExigibilite, statutsCarburant, {
    contexteDossier,
    ...(compteAutoliquidationDue !== undefined ? { compteAutoliquidationDue } : {}),
    ...(compteAutoliquidationDeductible !== undefined ? { compteAutoliquidationDeductible } : {}),
  });

  // Encaissements en compte d'attente déjà qualifiés 'vente' par un humain
  // (lors d'un cycle précédent, cf. anomaliesEncaissements plus haut) :
  // intégrés après coup, pas dans calculerTva lui-même — la donnée ne vient
  // pas de `ecritures` mais d'une décision stockée en base. Fusionnées avec
  // les régularisations clients (chantier B, calculées directement plus
  // haut, pas de round-trip DB nécessaire puisqu'un défaut est toujours
  // disponible) — même fonction d'intégration pour les deux, même forme de
  // données (ledgerEntryId, montantTTC, taux).
  const regularisations471 = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerRegularisationsAIntegrer(client, params.dossierId, params.periodeDebut)
  );
  const resultat = integrerRegularisations(resultatBrut, [...regularisations471, ...regularisationsClient]);

  if (process.env.DEBUG_CYCLE) {
    console.error(`[DEBUG_CYCLE] regularisations 471 integrees : ${JSON.stringify(regularisations471)}`);
    console.error(`[DEBUG_CYCLE] regularisations client integrees : ${JSON.stringify(regularisationsClient)}`);
    console.error(`[DEBUG_CYCLE] resultat.lignes : ${JSON.stringify(resultat.lignes)}`);
    console.error(`[DEBUG_CYCLE] resultat.ecrituresExclues : ${JSON.stringify(resultat.ecrituresExclues)}`);
  }

  const calculId = await avecContexteCabinet(pool, params.cabinetId, async (client) => {
    const id = await enregistrerCalcul(client, params.dossierId, params.periodeDebut, params.periodeFin, resultat);

    await enregistrerEvenementAudit(client, {
      dossierId: params.dossierId,
      typeEvenement: 'calcul_genere',
      moduleSource: 'module7_calcul',
      acteur: 'systeme',
      details: {
        calculId: id,
        periodeDebut: params.periodeDebut,
        periodeFin: params.periodeFin,
        tvaNette: resultat.tvaNette,
        sens: resultat.sens,
      },
    });

    return id;
  });

  return {
    statut: 'calcule',
    anomalies: toutesAnomalies,
    resultat,
    calculId,
    comptesACategoriser,
    comptesSansTauxAssigne,
    comptesClientSansTaux,
  };
}
