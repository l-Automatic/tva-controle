import type { PoolClient } from 'pg';
import type { Anomalie } from '@tva-controle/core';
import type { PropositionConvention } from '@tva-controle/onboarding-module3';
import type { PropositionTaux, PropositionTauxTiers } from '@tva-controle/onboarding-module3';
import type { ResultatCalculTva } from '@tva-controle/calcul-module7';

// ============================================================================
// AUDIT (Module 10)
// ============================================================================
// Point d'entrée unique pour toute écriture dans audit_log. Le cabinet_id
// n'est jamais passé en paramètre explicite : on relit celui déjà positionné
// par avecContexteCabinet (set_config, portée transaction) pour la
// transaction en cours, pour garantir que la ligne d'audit est toujours
// rattachée au même cabinet que le contexte RLS actif.
//
// À appeler TOUJOURS avec le même `client` que l'opération métier qu'elle
// documente, pour que les deux fassent partie de la même transaction : soit
// les deux sont commités ensemble, soit un rollback annule les deux.
export interface EvenementAudit {
  dossierId: string | null;
  typeEvenement: string;
  moduleSource: string;
  acteur: 'agent' | 'utilisateur' | 'systeme';
  acteurUtilisateurId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function enregistrerEvenementAudit(
  client: PoolClient,
  evenement: EvenementAudit
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (cabinet_id, dossier_id, type_evenement, module_source, acteur, acteur_utilisateur_id, details)
     VALUES (current_setting('app.current_cabinet_id', true)::UUID, $1, $2, $3, $4, $5, $6)`,
    [
      evenement.dossierId,
      evenement.typeEvenement,
      evenement.moduleSource,
      evenement.acteur,
      evenement.acteurUtilisateurId ?? null,
      evenement.details ? JSON.stringify(evenement.details) : null,
    ]
  );
}

// ============================================================================
// ANOMALIES
// ============================================================================

// Retourne les lignes insérées (avec leur id réel généré par Postgres) plutôt
// que rien : le pipeline (Module 9) en a besoin pour tracer précisément
// quelles anomalies ont bloqué un calcul dans l'événement d'audit
// correspondant, plutôt que de se contenter d'un décompte.
export async function enregistrerAnomalies(
  client: PoolClient,
  dossierId: string,
  periode: string, // YYYY-MM-DD, premier jour de la période contrôlée
  anomalies: Anomalie[]
): Promise<{ id: string; type: string; gravite: string }[]> {
  // Déduplication : sans ce nettoyage, relancer un cycle sur une période déjà
  // contrôlée réinsère un second lot d'anomalies par-dessus le premier au
  // lieu de le remplacer (pas d'échec visible, juste une accumulation
  // silencieuse). Pas de DELETE ici : le rôle applicatif n'a volontairement
  // aucun DELETE sur anomalies (002, section 2 — trace d'audit fiscale). Les
  // anomalies encore 'ouvert' passent en 'obsolete' (statut ajouté en 005),
  // 'resolu'/'justifie' (décision humaine) ne sont jamais touchées.
  await client.query(
    `UPDATE anomalies SET statut = 'obsolete' WHERE dossier_id = $1 AND periode = $2 AND statut = 'ouvert'`,
    [dossierId, periode]
  );

  const inserees: { id: string; type: string; gravite: string }[] = [];
  for (const a of anomalies) {
    const res = await client.query<{ id: string }>(
      `INSERT INTO anomalies (dossier_id, periode, type_anomalie, gravite, reference_piece, description, details, compte, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ouvert')
       RETURNING id`,
      [
        dossierId,
        periode,
        a.type,
        a.gravite,
        String(a.ledgerEntryId),
        a.description,
        a.details ? JSON.stringify(a.details) : null,
        a.compte,
      ]
    );
    inserees.push({ id: res.rows[0]!.id, type: a.type, gravite: a.gravite });
  }
  return inserees;
}

export async function resoudreAnomalie(
  client: PoolClient,
  anomalieId: string,
  utilisateurId: string,
  commentaire?: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; type_anomalie: string }>(
    `UPDATE anomalies SET statut = 'resolu', traite_par = $2, date_traitement = now(), commentaire_traitement = $3
     WHERE id = $1
     RETURNING dossier_id, type_anomalie`,
    [anomalieId, utilisateurId, commentaire ?? null]
  );
  const ligne = res.rows[0];
  await enregistrerEvenementAudit(client, {
    dossierId: ligne?.dossier_id ?? null,
    typeEvenement: 'anomalie_resolue',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { anomalieId, typeAnomalie: ligne?.type_anomalie, commentaire: commentaire ?? null },
  });
}

export async function justifierAnomalie(
  client: PoolClient,
  anomalieId: string,
  utilisateurId: string,
  commentaire: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; type_anomalie: string }>(
    `UPDATE anomalies SET statut = 'justifie', traite_par = $2, date_traitement = now(), commentaire_traitement = $3
     WHERE id = $1
     RETURNING dossier_id, type_anomalie`,
    [anomalieId, utilisateurId, commentaire]
  );
  const ligne = res.rows[0];
  await enregistrerEvenementAudit(client, {
    dossierId: ligne?.dossier_id ?? null,
    typeEvenement: 'anomalie_justifiee',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { anomalieId, typeAnomalie: ligne?.type_anomalie, commentaire },
  });
}

// Qualification d'une anomalie 'encaissement_non_affecte' (compte d'attente,
// cf. controles-module4/encaissementNonAffecte) : contrairement à
// resoudreAnomalie/justifierAnomalie, cette décision porte un résultat
// numérique (le taux de TVA retenu) que Module 7 doit pouvoir relire pour
// intégrer la régularisation au calcul — d'où une fonction dédiée plutôt
// qu'un paramètre de plus sur les fonctions génériques. Restreinte par le
// WHERE au bon type d'anomalie : évite qu'un appel API mal formé n'attache
// un taux à une anomalie qui n'en a pas l'usage.
export type QualificationEncaissement =
  | { decision: 'vente'; taux: number }
  | { decision: 'hors_vente'; motif: string };

// Levée par qualifierEncaissementNonAffecte quand l'anomalie visée n'est pas
// (ou plus) en 'ouvert' — même famille que CalculPasEnBrouillonError : évite
// qu'un second appel (onglet dupliqué, collègue plus rapide) n'écrase
// silencieusement une qualification déjà posée par quelqu'un d'autre.
export class AnomalieNonQualifiableError extends Error {
  constructor(anomalieId: string) {
    super(
      `Anomalie ${anomalieId} : introuvable, pas de type 'encaissement_non_affecte', ` +
        `ou déjà traitée (statut différent de 'ouvert').`
    );
    this.name = 'AnomalieNonQualifiableError';
  }
}

export async function qualifierEncaissementNonAffecte(
  client: PoolClient,
  anomalieId: string,
  utilisateurId: string,
  qualification: QualificationEncaissement
): Promise<void> {
  const statut = qualification.decision === 'vente' ? 'resolu' : 'justifie';
  const commentaire =
    qualification.decision === 'vente'
      ? `Qualifié comme lié à une vente — TVA collectée au taux de ${qualification.taux}%.`
      : qualification.motif;
  const resolution = qualification.decision === 'vente' ? { taux: qualification.taux } : null;

  const res = await client.query<{ dossier_id: string }>(
    `UPDATE anomalies SET statut = $2, traite_par = $3, date_traitement = now(),
       commentaire_traitement = $4, resolution = $5
     WHERE id = $1 AND type_anomalie = 'encaissement_non_affecte' AND statut = 'ouvert'
     RETURNING dossier_id`,
    [anomalieId, statut, utilisateurId, commentaire, resolution ? JSON.stringify(resolution) : null]
  );
  const ligne = res.rows[0];
  if (!ligne) {
    throw new AnomalieNonQualifiableError(anomalieId);
  }
  await enregistrerEvenementAudit(client, {
    dossierId: ligne.dossier_id,
    typeEvenement: 'encaissement_qualifie',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { anomalieId, ...qualification },
  });
}

// ============================================================================
// CONVENTIONS DOSSIER (propositions du Module 3, ou saisie manuelle)
// ============================================================================

export async function enregistrerPropositionsConventions(
  client: PoolClient,
  dossierId: string,
  propositions: PropositionConvention[]
): Promise<void> {
  for (const p of propositions) {
    await client.query(
      `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source, confidence_note)
       VALUES ($1, $2, $3, 'candidate', 'onboarding', $4)`,
      [dossierId, p.cle, JSON.stringify(p.valeur), p.confidenceNote]
    );
  }
}

// Confirmer une candidate neutralise automatiquement l'ancienne confirmed du
// même (dossier, cle) — sans ça, la contrainte d'unicité de 001 empêcherait
// la confirmation. C'est le remplacement explicite d'une convention par une
// nouvelle, pas un ajout en parallèle.
// Ajout manuel d'une convention via l'interface (Module 6) — même table et
// même statut de départ ('candidate') que les propositions automatiques du
// Module 3, mais source distincte pour la traçabilité. Reste 'candidate'
// comme toute proposition : même une saisie manuelle doit être confirmée
// explicitement, pas de raccourci qui court-circuiterait la règle "jamais de
// confirmation automatique".
export async function ajouterConventionManuelle(
  client: PoolClient,
  dossierId: string,
  utilisateurId: string,
  cle: string,
  valeur: unknown
): Promise<string> {
  let valeurFinale = valeur;
  if (Array.isArray(valeur)) {
    // Clé de type liste (ex: comptes_vente_service) : confirmerConvention
    // rejette la ligne confirmée existante à chaque nouvelle confirmation
    // plutôt que de la compléter (un seul 'confirmed' par clé à la fois,
    // invariant délibéré côté confirmerConvention — cf. son propre code).
    // Sans fusion ici, ajouter un second lot de comptes séparément écrasait
    // silencieusement le premier lot déjà confirmé. Bug réel trouvé le
    // 02/08 en conditions réelles.
    const existant = await client.query<{ valeur: unknown }>(
      `SELECT valeur FROM conventions_dossier WHERE dossier_id = $1 AND cle = $2 AND statut = 'confirmed'`,
      [dossierId, cle]
    );
    const dejaConfirme = existant.rows[0]?.valeur;
    if (Array.isArray(dejaConfirme)) {
      valeurFinale = [...new Set([...dejaConfirme, ...valeur])];
    }
  }

  const res = await client.query<{ id: string }>(
    `INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source)
     VALUES ($1, $2, $3, 'candidate', 'saisie_manuelle')
     RETURNING id`,
    [dossierId, cle, JSON.stringify(valeurFinale)]
  );
  const id = res.rows[0]!.id;
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'convention_ajoutee_manuellement',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { conventionId: id, cle, valeur: valeurFinale },
  });
  return id;
}

export async function confirmerConvention(
  client: PoolClient,
  conventionId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; cle: string }>(
    `SELECT dossier_id, cle FROM conventions_dossier WHERE id = $1`,
    [conventionId]
  );
  const ligne = res.rows[0];
  if (!ligne) {
    throw new Error(`Convention ${conventionId} introuvable`);
  }

  await client.query(
    `UPDATE conventions_dossier SET statut = 'rejected'
     WHERE dossier_id = $1 AND cle = $2 AND statut = 'confirmed' AND id != $3`,
    [ligne.dossier_id, ligne.cle, conventionId]
  );
  await client.query(
    `UPDATE conventions_dossier SET statut = 'confirmed', confirmed_by = $2, confirmed_at = now()
     WHERE id = $1`,
    [conventionId, utilisateurId]
  );
  await enregistrerEvenementAudit(client, {
    dossierId: ligne.dossier_id,
    typeEvenement: 'convention_confirmee',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { conventionId, cle: ligne.cle },
  });
}

// Retire un compte d'une convention de type liste déjà confirmée (ex:
// comptes_charge_service) — UPDATE direct de la ligne existante, PAS un
// nouveau cycle candidate/confirmed. Pas de ligne 'rejected' créée, pas de
// perte de la ligne confirmée elle-même : seule sa valeur change. Différent
// de rejeterConvention (qui rejette la ligne entière) — ici on modifie le
// contenu d'une liste, la convention elle-même reste confirmée. Demande de
// Rami (08/08) : la saisie manuelle répétée est chronophage, et le workflow
// candidate/confirmed pour un simple retrait créait un historique de
// rejets qui ne sert à rien.
export async function retirerCompteConvention(
  client: PoolClient,
  dossierId: string,
  cle: string,
  compte: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ id: string; valeur: unknown }>(
    `SELECT id, valeur FROM conventions_dossier WHERE dossier_id = $1 AND cle = $2 AND statut = 'confirmed'`,
    [dossierId, cle]
  );
  const ligne = res.rows[0];
  if (!ligne || !Array.isArray(ligne.valeur)) {
    throw new Error(`Aucune convention confirmée de type liste pour la clé "${cle}" sur ce dossier.`);
  }

  const nouvelleValeur = ligne.valeur.filter((v) => v !== compte);
  await client.query(`UPDATE conventions_dossier SET valeur = $2 WHERE id = $1`, [
    ligne.id,
    JSON.stringify(nouvelleValeur),
  ]);
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'convention_compte_retire',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { cle, compteRetire: compte, nouvelleValeur },
  });
}

export async function rejeterConvention(
  client: PoolClient,
  conventionId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; cle: string }>(
    `UPDATE conventions_dossier SET statut = 'rejected' WHERE id = $1 RETURNING dossier_id, cle`,
    [conventionId]
  );
  const ligne = res.rows[0];
  await enregistrerEvenementAudit(client, {
    dossierId: ligne?.dossier_id ?? null,
    typeEvenement: 'convention_rejetee',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { conventionId, cle: ligne?.cle },
  });
}

// ============================================================================
// TAUX HISTORIQUE (propositions du Module 3, ou saisie manuelle) — même
// logique que les conventions, table différente (migration 003).
// ============================================================================

// Ne propose qu'une fois par compte : si une ligne existe déjà (candidate,
// confirmed ou rejected), on ne la re-propose jamais, même si le taux
// dominant recalculé diffère de celui déjà proposé/tranché. Sans ce
// garde-fou, appeler cette fonction à chaque cycle (ce qui est le but,
// cf. pipeline.ts) créerait une nouvelle candidate à l'infini pour un
// compte déjà traité par un humain — "proposer une fois, laisser la
// confirmation humaine trancher" plutôt que de réévaluer en continu.
export async function enregistrerPropositionsTaux(
  client: PoolClient,
  dossierId: string,
  propositions: PropositionTaux[]
): Promise<void> {
  for (const p of propositions) {
    await client.query(
      `INSERT INTO taux_historique (dossier_id, compte_produit_ou_charge, taux_habituel, nb_occurrences, statut, source)
       SELECT $1, $2, $3, $4, 'candidate', 'onboarding'
       WHERE NOT EXISTS (
         SELECT 1 FROM taux_historique WHERE dossier_id = $1 AND compte_produit_ou_charge = $2
       )`,
      [dossierId, p.compteOuTiers, p.tauxHabituel, p.nbOccurrences]
    );
  }
}

export async function confirmerTauxHistorique(
  client: PoolClient,
  tauxId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; compte_produit_ou_charge: string }>(
    `SELECT dossier_id, compte_produit_ou_charge FROM taux_historique WHERE id = $1`,
    [tauxId]
  );
  const ligne = res.rows[0];
  if (!ligne) {
    throw new Error(`Taux historique ${tauxId} introuvable`);
  }

  await client.query(
    `UPDATE taux_historique SET statut = 'rejected'
     WHERE dossier_id = $1 AND compte_produit_ou_charge = $2 AND statut = 'confirmed' AND id != $3`,
    [ligne.dossier_id, ligne.compte_produit_ou_charge, tauxId]
  );
  await client.query(
    `UPDATE taux_historique SET statut = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1`,
    [tauxId, utilisateurId]
  );
  await enregistrerEvenementAudit(client, {
    dossierId: ligne.dossier_id,
    typeEvenement: 'taux_confirme',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { tauxId, compteProduitOuCharge: ligne.compte_produit_ou_charge },
  });
}

export async function rejeterTauxHistorique(
  client: PoolClient,
  tauxId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; compte_produit_ou_charge: string }>(
    `UPDATE taux_historique SET statut = 'rejected' WHERE id = $1
     RETURNING dossier_id, compte_produit_ou_charge`,
    [tauxId]
  );
  const ligne = res.rows[0];
  await enregistrerEvenementAudit(client, {
    dossierId: ligne?.dossier_id ?? null,
    typeEvenement: 'taux_rejete',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { tauxId, compteProduitOuCharge: ligne?.compte_produit_ou_charge },
  });
}

// ============================================================================
// TAUX HISTORIQUE PAR TIERS (chantier B — encaissements clients non lettrés)
// ============================================================================
// Symétrique de enregistrerPropositionsTaux/confirmerTauxHistorique/
// rejeterTauxHistorique ci-dessus, mais sur taux_historique_tiers (table
// séparée, cf. migration 009 — compte_produit_ou_charge est NOT NULL sur
// taux_historique, une table dédiée évite de toucher à cette contrainte).

// Même garde-fou que enregistrerPropositionsTaux : ne propose qu'une fois
// par compte tiers.
export async function enregistrerPropositionsTauxTiers(
  client: PoolClient,
  dossierId: string,
  propositions: PropositionTauxTiers[]
): Promise<void> {
  for (const p of propositions) {
    await client.query(
      `INSERT INTO taux_historique_tiers (dossier_id, numero_compte_tiers, taux_habituel, nb_occurrences, statut, source)
       SELECT $1, $2, $3, $4, 'candidate', 'onboarding'
       WHERE NOT EXISTS (
         SELECT 1 FROM taux_historique_tiers WHERE dossier_id = $1 AND numero_compte_tiers = $2
       )`,
      [dossierId, p.numeroCompteTiers, p.tauxHabituel, p.nbOccurrences]
    );
  }
}

export async function confirmerTauxHistoriqueTiers(
  client: PoolClient,
  tauxId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; numero_compte_tiers: string }>(
    `SELECT dossier_id, numero_compte_tiers FROM taux_historique_tiers WHERE id = $1`,
    [tauxId]
  );
  const ligne = res.rows[0];
  if (!ligne) {
    throw new Error(`Taux historique tiers ${tauxId} introuvable`);
  }

  await client.query(
    `UPDATE taux_historique_tiers SET statut = 'rejected'
     WHERE dossier_id = $1 AND numero_compte_tiers = $2 AND statut = 'confirmed' AND id != $3`,
    [ligne.dossier_id, ligne.numero_compte_tiers, tauxId]
  );
  await client.query(
    `UPDATE taux_historique_tiers SET statut = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1`,
    [tauxId, utilisateurId]
  );
  await enregistrerEvenementAudit(client, {
    dossierId: ligne.dossier_id,
    typeEvenement: 'taux_tiers_confirme',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { tauxId, numeroCompteTiers: ligne.numero_compte_tiers },
  });
}

export async function rejeterTauxHistoriqueTiers(
  client: PoolClient,
  tauxId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; numero_compte_tiers: string }>(
    `UPDATE taux_historique_tiers SET statut = 'rejected' WHERE id = $1
     RETURNING dossier_id, numero_compte_tiers`,
    [tauxId]
  );
  const ligne = res.rows[0];
  await enregistrerEvenementAudit(client, {
    dossierId: ligne?.dossier_id ?? null,
    typeEvenement: 'taux_tiers_rejete',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { tauxId, numeroCompteTiers: ligne?.numero_compte_tiers },
  });
}

// ============================================================================
// CALCUL TVA
// ============================================================================

// Levée quand un cycle est relancé sur une période dont le calcul a déjà
// été 'valide' ou 'declare'. Le trigger d'immuabilité (002) protège les
// UPDATE, mais c'est cette fonction qui empêche toute autre action sur un
// calcul déjà validé — un DELETE du header n'est de toute façon jamais
// possible ici : le rôle applicatif n'a aucun DELETE sur calculs_tva
// (002, section 2 — "Aucun DELETE nulle part, sauf calculs_tva_lignes").
export class CalculDejaValideError extends Error {
  constructor(statut: string) {
    super(
      `Un calcul TVA existe déjà pour ce dossier sur cette période (statut '${statut}'). ` +
        `Impossible de relancer un cycle sans le repasser en brouillon au préalable.`
    );
    this.name = 'CalculDejaValideError';
  }
}

export async function enregistrerCalcul(
  client: PoolClient,
  dossierId: string,
  periodeDebut: string,
  periodeFin: string,
  resultat: ResultatCalculTva
): Promise<string> {
  const existant = await client.query<{ id: string; statut: string }>(
    `SELECT id, statut FROM calculs_tva WHERE dossier_id = $1 AND periode_debut = $2 AND periode_fin = $3`,
    [dossierId, periodeDebut, periodeFin]
  );

  let calculId: string;

  if (existant.rows.length > 0) {
    const { id, statut } = existant.rows[0]!;
    if (statut === 'valide' || statut === 'declare') {
      throw new CalculDejaValideError(statut);
    }
    // Brouillon ou rejete existant : on le met à jour en place plutôt que de
    // le recréer (pas de DELETE possible sur calculs_tva). Un calcul rejeté
    // redevient 'brouillon' à la relance — le rejet n'est pas un état
    // terminal, juste une façon d'écarter un brouillon erroné en attendant
    // de le refaire. Les lignes, elles, peuvent être supprimées : DELETE
    // exceptionnel accordé sur calculs_tva_lignes tant que le header reste
    // 'brouillon' (002/section 5) — pas encore le cas juste avant cet UPDATE
    // si le calcul était 'rejete', d'où l'ordre : header d'abord, lignes
    // ensuite.
    await client.query(
      `UPDATE calculs_tva SET statut = 'brouillon', tva_nette = $2, sens = $3, date_calcul = now() WHERE id = $1`,
      [id, resultat.tvaNette, resultat.sens]
    );
    await client.query(`DELETE FROM calculs_tva_lignes WHERE calcul_id = $1`, [id]);
    calculId = id;
  } else {
    const resCalcul = await client.query<{ id: string }>(
      `INSERT INTO calculs_tva (dossier_id, periode_debut, periode_fin, statut, tva_nette, sens)
       VALUES ($1, $2, $3, 'brouillon', $4, $5)
       RETURNING id`,
      [dossierId, periodeDebut, periodeFin, resultat.tvaNette, resultat.sens]
    );
    calculId = resCalcul.rows[0]!.id;
  }

  for (const ligne of resultat.lignes) {
    await client.query(
      `INSERT INTO calculs_tva_lignes (calcul_id, categorie, montant, nb_ecritures_source, references_pieces)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        calculId,
        ligne.categorie,
        ligne.montant,
        ligne.referencesPieces.length,
        ligne.referencesPieces.map(String),
      ]
    );
  }

  return calculId;
}

// Levée par validerCalcul/rejeterCalcul quand le calcul visé n'est pas (ou
// plus) en 'brouillon' — évite qu'un appel API direct (hors UI, qui masque
// déjà le bouton) ne valide/rejette silencieusement un calcul déjà traité.
export class CalculPasEnBrouillonError extends Error {
  constructor(calculId: string) {
    super(`Calcul ${calculId} : introuvable ou plus en statut 'brouillon' (déjà validé, déclaré ou rejeté).`);
    this.name = 'CalculPasEnBrouillonError';
  }
}

// Passe le calcul en 'valide' — le trigger d'immuabilité (002) garantit que
// plus rien ne peut modifier son montant après ce point.
export async function validerCalcul(
  client: PoolClient,
  calculId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; tva_nette: string; sens: string }>(
    `UPDATE calculs_tva SET statut = 'valide', valide_par = $2, date_validation = now()
     WHERE id = $1 AND statut = 'brouillon'
     RETURNING dossier_id, tva_nette, sens`,
    [calculId, utilisateurId]
  );
  const ligne = res.rows[0];
  if (!ligne) {
    throw new CalculPasEnBrouillonError(calculId);
  }
  await enregistrerEvenementAudit(client, {
    dossierId: ligne.dossier_id,
    typeEvenement: 'calcul_valide',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { calculId, tvaNette: ligne.tva_nette, sens: ligne.sens },
  });
}

// Passe le calcul en 'rejete' — pour écarter un brouillon erroné (ex :
// mauvaise période saisie) sans le supprimer (pas de DELETE possible sur
// calculs_tva). Reste en base pour la trace, redevient 'brouillon' si le
// cycle est relancé sur la même période (cf. enregistrerCalcul).
export async function rejeterCalcul(
  client: PoolClient,
  calculId: string,
  utilisateurId: string,
  motif: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string }>(
    `UPDATE calculs_tva SET statut = 'rejete'
     WHERE id = $1 AND statut = 'brouillon'
     RETURNING dossier_id`,
    [calculId]
  );
  const ligne = res.rows[0];
  if (!ligne) {
    throw new CalculPasEnBrouillonError(calculId);
  }
  await enregistrerEvenementAudit(client, {
    dossierId: ligne.dossier_id,
    typeEvenement: 'calcul_rejete',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { calculId, motif },
  });
}

// ============================================================================
// PARAMÉTRAGE (cabinet et dossier)
// ============================================================================
// Pas de workflow candidate/confirmed comme conventions_dossier : un
// paramètre est une décision directe du cabinet/collaborateur (ex: une clé
// API), pas une proposition détectée automatiquement à valider.

// Jamais la valeur elle-même dans l'audit pour ces clés — seul le fait
// qu'un secret ait été modifié est tracé, jamais son contenu.
const CLES_SECRETES = new Set(['mistral_api_key']);

export async function definirParametreCabinet(
  client: PoolClient,
  cabinetId: string,
  cle: string,
  valeur: unknown,
  utilisateurId: string
): Promise<void> {
  await client.query(
    `INSERT INTO parametres_cabinet (cabinet_id, cle, valeur)
     VALUES ($1, $2, $3)
     ON CONFLICT (cabinet_id, cle) DO UPDATE SET valeur = EXCLUDED.valeur, updated_at = now()`,
    [cabinetId, cle, JSON.stringify(valeur)]
  );
  await enregistrerEvenementAudit(client, {
    dossierId: null,
    typeEvenement: 'parametre_cabinet_modifie',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: CLES_SECRETES.has(cle) ? { cle, secret: true } : { cle, valeur },
  });
}

export async function definirParametreDossier(
  client: PoolClient,
  dossierId: string,
  cle: string,
  valeur: unknown,
  utilisateurId: string
): Promise<void> {
  await client.query(
    `INSERT INTO parametres_dossier (dossier_id, cle, valeur)
     VALUES ($1, $2, $3)
     ON CONFLICT (dossier_id, cle) DO UPDATE SET valeur = EXCLUDED.valeur, updated_at = now()`,
    [dossierId, cle, JSON.stringify(valeur)]
  );
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'parametre_dossier_modifie',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: CLES_SECRETES.has(cle) ? { cle, secret: true } : { cle, valeur },
  });
}

// ============================================================================
// TIERS_REFERENCE (mémoire de confiance des tiers)
// ============================================================================
// Progression volontairement simple pour cette v1 : un compteur de cycles
// où le tiers est apparu, sans croiser avec les autres anomalies du cycle
// (ex: un tiers impliqué dans une anomalie sans rapport avec lui-même ne
// voit pas sa progression bloquée) — croiser les deux ajouterait une
// dépendance complexe pour un bénéfice pas démontré. Seuils arbitraires,
// documentés comme tels : à ajuster une fois qu'on aura du recul réel,
// bon candidat pour devenir un paramètre dossier/cabinet (cf. 008) plutôt
// qu'une constante en dur si le besoin se confirme.
const SEUIL_A_SURVEILLER = 3;
const SEUIL_CONFIANCE = 6;

export interface StatutTiersASynchroniser {
  numeroCompteTiers: string;
  nomTiers: string | null;
  estNouveau: boolean;
}

// Pas de DELETE (comme partout ailleurs) : un tiers nouveau est un INSERT,
// un tiers déjà connu progresse par UPDATE. Idempotent en pratique — appelé
// une fois par cycle réussi, jamais deux fois pour la même période avec les
// mêmes lignes (le pipeline ne rappelle cette fonction qu'une fois par
// exécution de cycle).
export async function synchroniserTiersReference(
  client: PoolClient,
  dossierId: string,
  statuts: StatutTiersASynchroniser[],
  periodeFin: string
): Promise<void> {
  for (const s of statuts) {
    if (s.estNouveau) {
      await client.query(
        `INSERT INTO tiers_reference
           (dossier_id, numero_compte_tiers, nom_tiers, niveau_confiance, nb_controles_sans_anomalie, derniere_date_controle)
         VALUES ($1, $2, $3, 'nouveau', 0, $4)
         ON CONFLICT (dossier_id, numero_compte_tiers) DO NOTHING`,
        [dossierId, s.numeroCompteTiers, s.nomTiers, periodeFin]
      );
    } else {
      await client.query(
        `UPDATE tiers_reference
         SET nb_controles_sans_anomalie = nb_controles_sans_anomalie + 1,
             derniere_date_controle = $3,
             nom_tiers = COALESCE(nom_tiers, $4),
             niveau_confiance = CASE
               WHEN nb_controles_sans_anomalie + 1 >= $5 THEN 'confiance'
               WHEN nb_controles_sans_anomalie + 1 >= $6 THEN 'a_surveiller'
               ELSE niveau_confiance
             END
         WHERE dossier_id = $1 AND numero_compte_tiers = $2`,
        [dossierId, s.numeroCompteTiers, periodeFin, s.nomTiers, SEUIL_CONFIANCE, SEUIL_A_SURVEILLER]
      );
    }
  }
}

// Correction manuelle du niveau de confiance d'un tiers — la progression
// automatique (synchroniserTiersReference) reste la voie normale, mais un
// collaborateur peut avoir une information directe (ex: fournisseur connu
// personnellement depuis des années malgré peu de cycles passés dans ce
// logiciel, ou inversement un doute sur un tiers déjà en 'confiance').
// Demande de Rami (08/08) : pouvoir corriger toute décision déjà actée par
// le logiciel, pas seulement celles encore en attente.
export async function corrigerNiveauConfianceTiers(
  client: PoolClient,
  dossierId: string,
  numeroCompteTiers: string,
  niveauConfiance: 'nouveau' | 'a_surveiller' | 'confiance',
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ id: string }>(
    `UPDATE tiers_reference SET niveau_confiance = $3
     WHERE dossier_id = $1 AND numero_compte_tiers = $2
     RETURNING id`,
    [dossierId, numeroCompteTiers, niveauConfiance]
  );
  if (res.rows.length === 0) {
    throw new Error(`Tiers ${numeroCompteTiers} introuvable pour ce dossier.`);
  }
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'tiers_confiance_corrigee',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { numeroCompteTiers, niveauConfiance },
  });
}

// ============================================================================
// TAUX ASSIGNÉ PAR COMPTE (produit ou charge) — assignation directe, pas
// une observation. Cf. migration 010 pour le raisonnement complet.
// ============================================================================

export type TauxAssigne =
  | '0'
  | '2.1'
  | '5.5'
  | '10'
  | '20'
  | 'autoliquide_intracom'
  | 'autoliquide_20'
  | 'autoliquide_10'
  | 'autoliquide_5.5';

// Assignation directe, pas de workflow candidate/confirmed — un simple
// upsert. Contrairement aux conventions de comptes (listes), c'est une
// valeur unique par compte, remplacée telle quelle si déjà assignée.
export async function assignerTauxCompte(
  client: PoolClient,
  dossierId: string,
  compte: string,
  taux: TauxAssigne,
  utilisateurId: string
): Promise<void> {
  await client.query(
    `INSERT INTO taux_assigne_compte (dossier_id, compte_produit_ou_charge, taux_assigne)
     VALUES ($1, $2, $3)
     ON CONFLICT (dossier_id, compte_produit_ou_charge) DO UPDATE SET taux_assigne = EXCLUDED.taux_assigne, updated_at = now()`,
    [dossierId, compte, taux]
  );
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'taux_compte_assigne',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { compte, taux },
  });
}

// Résolution en masse — demande de Rami (08/08) : une liste d'anomalies
// signalées peut être longue, traiter une par une est lourd. Un seul
// commentaire partagé pour tout le lot (pas de faux-semblant d'analyse
// individuelle), restreint aux anomalies encore 'ouvert' (les ids déjà
// traités passés par erreur sont silencieusement ignorés, pas une erreur).
// Un seul événement d'audit pour tout le lot plutôt qu'un par anomalie :
// plus lisible dans l'historique qu'une rafale de N lignes identiques.
export async function resoudreAnomaliesEnMasse(
  client: PoolClient,
  anomalieIds: string[],
  utilisateurId: string,
  commentaire: string
): Promise<{ dossierId: string | null; nombreResolues: number }> {
  if (anomalieIds.length === 0) {
    return { dossierId: null, nombreResolues: 0 };
  }

  const res = await client.query<{ id: string; dossier_id: string }>(
    `UPDATE anomalies SET statut = 'resolu', traite_par = $2, date_traitement = now(), commentaire_traitement = $3
     WHERE id = ANY($1) AND statut = 'ouvert'
     RETURNING id, dossier_id`,
    [anomalieIds, utilisateurId, commentaire]
  );

  const dossierId = res.rows[0]?.dossier_id ?? null;
  if (dossierId) {
    await enregistrerEvenementAudit(client, {
      dossierId,
      typeEvenement: 'anomalies_resolues_en_masse',
      moduleSource: 'module6_validation',
      acteur: 'utilisateur',
      acteurUtilisateurId: utilisateurId,
      details: { anomalieIds: res.rows.map((r) => r.id), commentaire },
    });
  }

  return { dossierId, nombreResolues: res.rows.length };
}

// Assignation directe et immédiate d'un taux habituel pour un compte
// client, sans attendre le seuil de 3 factures lettrées observées — demande
// de Rami (08/08) : un collaborateur qui connaît déjà le taux d'un client
// (ex: client toujours facturé à 10%) doit pouvoir le renseigner
// directement, pas attendre que l'historique s'accumule. Contrairement à
// enregistrerPropositionsTauxTiers (candidate, détecté automatiquement),
// celle-ci confirme immédiatement — c'est une décision humaine directe, pas
// une proposition à valider. Remplace toute confirmation précédente pour ce
// même compte (upsert sur la ligne confirmed).
export async function assignerTauxHistoriqueTiersManuel(
  client: PoolClient,
  dossierId: string,
  numeroCompteTiers: string,
  tauxHabituel: number,
  utilisateurId: string
): Promise<void> {
  await client.query(
    `INSERT INTO taux_historique_tiers (dossier_id, numero_compte_tiers, taux_habituel, nb_occurrences, statut, source, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, 0, 'confirmed', 'saisie_manuelle', $4, now())
     ON CONFLICT (dossier_id, numero_compte_tiers) WHERE statut = 'confirmed'
     DO UPDATE SET taux_habituel = EXCLUDED.taux_habituel, source = 'saisie_manuelle',
                    confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now(), derniere_maj = now()`,
    [dossierId, numeroCompteTiers, tauxHabituel, utilisateurId]
  );
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'taux_tiers_assigne_manuellement',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { numeroCompteTiers, tauxHabituel },
  });
}

// ============================================================================
// PARC VÉHICULES (immobilisations) — gestion manuelle
// ============================================================================
// La table immobilisations existe depuis le schéma initial (candidate/
// confirmed, source saisie_manuelle déjà prévue) mais rien ne l'alimentait
// jusqu'ici — aucune fonction d'écriture n'existait, malgré le contrôle
// carburant qui en dépend entièrement (parc_vehicules_non_renseigne
// systématique en conséquence). Demande de Rami (09/08) : ajout manuel
// direct, confirmé tout de suite — pas de friction candidate/confirmed
// pour une saisie humaine directe (même logique que assignerTauxCompte).

export interface VehiculeManuel {
  designation?: string;
  typeBien: 'vehicule_tourisme' | 'vehicule_utilitaire' | 'autre';
  montantHt?: number;
  dateAcquisition?: string;
}

export async function ajouterVehiculeManuel(
  client: PoolClient,
  dossierId: string,
  vehicule: VehiculeManuel,
  utilisateurId: string
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO immobilisations (dossier_id, compte, designation, montant_ht, date_acquisition, type_bien, statut, source, confirmed_by, confirmed_at)
     VALUES ($1, '2182', $2, $3, $4, $5, 'confirmed', 'saisie_manuelle', $6, now())
     RETURNING id`,
    [
      dossierId,
      vehicule.designation ?? null,
      vehicule.montantHt ?? null,
      vehicule.dateAcquisition ?? null,
      vehicule.typeBien,
      utilisateurId,
    ]
  );
  const id = res.rows[0]!.id;
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'vehicule_ajoute_manuellement',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { immobilisationId: id, typeBien: vehicule.typeBien, designation: vehicule.designation },
  });
  return id;
}

export async function retirerVehicule(client: PoolClient, immobilisationId: string, utilisateurId: string): Promise<void> {
  const res = await client.query<{ dossier_id: string }>(
    `UPDATE immobilisations SET statut = 'rejected' WHERE id = $1 RETURNING dossier_id`,
    [immobilisationId]
  );
  const dossierId = res.rows[0]?.dossier_id ?? null;
  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'vehicule_retire',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { immobilisationId },
  });
}
