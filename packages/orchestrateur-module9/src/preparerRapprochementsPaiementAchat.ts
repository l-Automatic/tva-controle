import type { Pool } from 'pg';
import type { IPennylaneApiClient } from '@tva-controle/connector-pennylane';
import {
  fetchTrialBalance,
  filterComptesParPrefixe,
  fetchEcrituresTvaCompletes,
  fetchLignesParCompte,
  resolveLedgerAccounts,
} from '@tva-controle/connector-pennylane';
import { identifierFacturesCandidatesAcompte, verifierCoherenceTvaHotel, identifierCandidatsJugementHotel } from '@tva-controle/controles-module4';
import { MistralClient, jugerCandidatsPaiementAchat, jugerLibellesHotel } from '@tva-controle/connector-mistral';
import { avecContexteCabinet } from './db/pool.js';
import { chargerContexteDossier, chargerDossierComplet, conventionListe } from './db/dossierRepository.js';
import { parametreCabinetValeur, listerFacturesLedgerEntryIdsRapprochees, listerPaiementsDejaReclames } from './db/readRepository.js';
import { autoResoudreFactureSansCandidat } from './db/writeRepository.js';

// Prépare le contenu du popup de rapprochement des paiements achats
// (10/08, refonte complète demandée par Rami — remplace les deux anciens
// mécanismes automatiques). Une facture de service non payée est présentée
// avec TOUS les paiements candidats du même compte fournisseur trouvés
// sur toute la fenêtre de l'EXERCICE (pas 60 jours comme avant — "on ne
// sait jamais, un service peut être payé bien après la date de
// facturation", décision explicite de Rami), avec un précochage IA quand
// fiable — jamais une décision finale prise par le LLM seul.

export interface CandidatPaiementPopup {
  ledgerEntryId: number;
  libelle: string | null;
  montant: number;
  date: string;
  precoche: boolean;
  confiance: 'haute' | 'moyenne' | 'basse' | null; // null = pas de précochage (IA non configurée, ou n'a pas pu se prononcer)
}

export interface FactureARapprocher {
  ledgerEntryId: number;
  compteFournisseur: string;
  libelleCompteFournisseur: string | null;
  libelle: string | null;
  montantFactureTotal: number;
  date: string;
  candidats: CandidatPaiementPopup[];
}

export interface ParametresPreparationRapprochements {
  cabinetId: string;
  dossierId: string;
  client: IPennylaneApiClient;
  periodeDebut: string;
  periodeFin: string;
}

export async function preparerRapprochementsPaiementAchat(
  pool: Pool,
  params: ParametresPreparationRapprochements
): Promise<FactureARapprocher[]> {
  const contexteDossier = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerContexteDossier(client, params.dossierId)
  );
  const dossierComplet = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    chargerDossierComplet(client, params.dossierId)
  );
  const comptesChargeService = conventionListe(contexteDossier, 'comptes_charge_service') ?? [];

  // Même chaîne légère que verifierComptesNonReconnus / verifierComptesACategoriser
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

  const mistralApiKey = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    parametreCabinetValeur(client, params.cabinetId, 'mistral_api_key')
  );

  // Exception hôtel (10/08) : un compte 625 (paiement comptant par défaut)
  // peut en pratique être réglé en plusieurs fois — sans cette détection,
  // une facture d'hôtel payée en deux fois serait silencieusement traitée
  // comme "déjà réglée comptant, rien à vérifier". Même logique que dans
  // executerCycleTva (pipeline.ts) — dupliquée ici car ce popup tourne
  // maintenant AVANT le cycle, plus dans son enchaînement.
  const comptesFournisseurConcernes = [
    ...new Set(
      ecritures
        .filter((e) => e.ligneTva.compte.startsWith('44566'))
        .map((e) => e.lignesTiers[0]?.compte)
        .filter((c): c is string => c !== undefined)
    ),
  ];
  const nomsComptesFournisseur =
    comptesFournisseurConcernes.length > 0
      ? new Map(
          [...(await resolveLedgerAccounts(params.client, comptesFournisseurConcernes)).entries()].map(
            ([numero, resolu]) => [numero, resolu.libelle]
          )
        )
      : new Map<string, string>();
  const anomaliesHotel = verifierCoherenceTvaHotel(ecritures, nomsComptesFournisseur);

  const ledgerEntryIdsHotel = new Set<number>(anomaliesHotel.map((a) => a.ledgerEntryId));
  if (typeof mistralApiKey === 'string' && mistralApiKey.length > 0) {
    const candidatsJugementHotel = identifierCandidatsJugementHotel(ecritures, nomsComptesFournisseur);
    if (candidatsJugementHotel.length > 0) {
      try {
        const mistralClientHotel = new MistralClient({ apiKey: mistralApiKey });
        const jugements = await jugerLibellesHotel(mistralClientHotel, candidatsJugementHotel);
        for (const j of jugements.filter((j) => j.estHotel)) {
          ledgerEntryIdsHotel.add(j.ledgerEntryId);
        }
      } catch (err) {
        if (process.env.DEBUG_CYCLE) {
          console.error(`[DEBUG_CYCLE] échec jugement IA (hôtel, popup rapprochement) : ${String(err)}`);
        }
      }
    }
  }

  const facturesCandidates = identifierFacturesCandidatesAcompte(ecritures, comptesChargeService, ledgerEntryIdsHotel);

  const dejaResolues = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerFacturesLedgerEntryIdsRapprochees(client, params.dossierId, params.periodeDebut)
  );
  const facturesARapprocher = facturesCandidates.filter((f) => !dejaResolues.has(f.ledgerEntryId));

  // Un paiement déjà rattaché à une AUTRE facture (n'importe quelle
  // période du dossier) ne doit jamais réapparaître comme candidat
  // ailleurs (10/08, demande de Rami) — double garantie avec le refus
  // côté écriture (enregistrerRapprochementPaiementAchat).
  const paiementsDejaReclames = await avecContexteCabinet(pool, params.cabinetId, (client) =>
    listerPaiementsDejaReclames(client, params.dossierId)
  );

  // Fenêtre = tout l'exercice comptable du dossier — repli sur l'année
  // civile de la période si l'exercice n'a pas encore été renseigné
  // (champ ajouté migration 015, pas toujours déjà rempli).
  const anneeCivile = params.periodeDebut.slice(0, 4);
  const exerciceDebut = dossierComplet?.dateDebutExercice ?? `${anneeCivile}-01-01`;
  const exerciceFin = dossierComplet?.dateFinExercice ?? `${anneeCivile}-12-31`;

  const mistralClient =
    typeof mistralApiKey === 'string' && mistralApiKey.length > 0 ? new MistralClient({ apiKey: mistralApiKey }) : null;

  const resultat: FactureARapprocher[] = [];

  for (const facture of facturesARapprocher) {
    const mouvementsCompte = await fetchLignesParCompte(params.client, {
      compteIds: [facture.compteTiersId],
      periodeDebut: exerciceDebut,
      periodeFin: exerciceFin,
    });
    // Un vrai paiement RÉDUIT ce qui est dû au fournisseur -> toujours au
    // DÉBIT sur un compte 401 (10/08, bug réel corrigé — sans ce filtre,
    // d'autres FACTURES du même fournisseur, au crédit, apparaissaient à
    // tort comme candidats de règlement). Peu importe le journal d'origine
    // (banque, caisse, OD) — le sens comptable suffit, pas besoin de
    // connaître le journal précis.
    const candidatsBruts = mouvementsCompte.filter(
      (l) =>
        l.ledgerEntryId !== facture.ledgerEntryId &&
        !l.lettrage.estLettree &&
        l.debit > 0 &&
        !paiementsDejaReclames.has(l.ledgerEntryId)
    );

    // Aucun candidat du tout (10/08, demande de Rami) : rien à faire
    // décider au collaborateur, on sait déjà que ce n'est pas déductible.
    // Résolu automatiquement plutôt que de l'afficher pour une
    // confirmation vide sans intérêt — retiré du panneau.
    if (candidatsBruts.length === 0) {
      await avecContexteCabinet(pool, params.cabinetId, (client) =>
        autoResoudreFactureSansCandidat(client, params.dossierId, params.periodeDebut, facture.ledgerEntryId, facture.montantFactureTotal)
      );
      continue;
    }

    let precochageParId = new Map<number, { precoche: boolean; confiance: 'haute' | 'moyenne' | 'basse' }>();
    if (mistralClient && candidatsBruts.length > 0) {
      try {
        const jugement = await jugerCandidatsPaiementAchat(
          mistralClient,
          { libelle: facture.libelle, montant: facture.montantFactureTotal, date: facture.date },
          candidatsBruts.map((l) => ({
            ledgerEntryId: l.ledgerEntryId,
            libelle: l.libelle,
            montant: Math.abs(l.debit - l.credit),
            date: l.date,
          }))
        );
        if (jugement.candidats) {
          precochageParId = new Map(jugement.candidats.map((c) => [c.ledgerEntryId, c]));
        }
      } catch (err) {
        if (process.env.DEBUG_CYCLE) {
          console.error(`[DEBUG_CYCLE] échec précochage rapprochement paiement (facture ${facture.ledgerEntryId}) : ${String(err)}`);
        }
        // Rien de précoché — jamais une erreur qui empêche d'afficher le popup lui-même.
      }
    }

    resultat.push({
      ledgerEntryId: facture.ledgerEntryId,
      compteFournisseur: facture.compteTiers,
      libelleCompteFournisseur: nomsComptesFournisseur.get(facture.compteTiers) ?? null,
      libelle: facture.libelle,
      montantFactureTotal: facture.montantFactureTotal,
      date: facture.date,
      candidats: candidatsBruts.map((l) => {
        const p = precochageParId.get(l.ledgerEntryId);
        return {
          ledgerEntryId: l.ledgerEntryId,
          libelle: l.libelle,
          montant: Math.abs(l.debit - l.credit),
          date: l.date,
          precoche: p?.precoche ?? false,
          confiance: p?.confiance ?? null,
        };
      }),
    });
  }

  // Rangé par compte fournisseur (ordre alphabétique), puis par date
  // (ordre chronologique) au sein d'un même compte — demande de Rami.
  resultat.sort((a, b) => {
    const parCompte = a.compteFournisseur.localeCompare(b.compteFournisseur);
    if (parCompte !== 0) return parCompte;
    return a.date.localeCompare(b.date);
  });

  return resultat;
}
