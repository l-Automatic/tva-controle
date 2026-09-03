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

// Symétrique de enregistrerAnomalies, mais scopée à un sous-ensemble de
// types (10/08) — pour une vérification ciblée et légère (ex: "ce compte
// est-il maintenant reconnu ?"), sans repasser par un cycle complet qui
// réexaminerait tout. Marque obsolete UNIQUEMENT les anomalies ouvertes
// dont le type fait partie de typesVerifies — jamais les autres, qui
// n'ont pas été réexaminées par cet appel précis et doivent rester
// intactes. Réutilisable pour n'importe quelle future vérification ciblée
// du même genre, pas seulement compte_tva_non_reconnu.
export async function enregistrerAnomaliesPartielles(
  client: PoolClient,
  dossierId: string,
  periode: string,
  typesVerifies: string[],
  anomalies: Anomalie[]
): Promise<{ id: string; type: string; gravite: string }[]> {
  await client.query(
    `UPDATE anomalies SET statut = 'obsolete'
     WHERE dossier_id = $1 AND periode = $2 AND statut = 'ouvert' AND type_anomalie = ANY($3)`,
    [dossierId, periode, typesVerifies]
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

// Somme brute des lignes de calcul pour la catégorie "collectée" — inclut
// autoliquidation_due (définition fiscalement correcte, une ligne CA3
// "TVA collectée" inclut la TVA due autoliquidée) — À VÉRIFIER que cette
// définition correspond bien à ce que le frontend affiche déjà comme
// "TVA collectée totale" (calculée côté frontend depuis les lignes brutes,
// jamais vérifié directement contre cette définition backend).
const CATEGORIES_PAR_TYPE_MONTANT: Record<'collectee_totale' | 'deductible_totale', string[]> = {
  collectee_totale: ['collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1', 'autoliquidation_due'],
  deductible_totale: ['deductible_abs', 'deductible_immo', 'autoliquidation_deductible'],
};

// Généralisée (10/08) — gérait jusqu'ici uniquement collectee_totale
// (construite pour encaissement_non_affecte) ; élargie pour couvrir aussi
// deductible_totale, nécessaire pour le nouveau mécanisme de vérification
// des avoirs côté achats.
async function calculerMontantActuelPourType(
  client: PoolClient,
  calculId: string,
  typeMontant: 'collectee_totale' | 'deductible_totale'
): Promise<number> {
  const ajustementExistant = await client.query<{ montant_ajuste: string }>(
    `SELECT montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = $2`,
    [calculId, typeMontant]
  );
  if (ajustementExistant.rows.length > 0) {
    return Number.parseFloat(ajustementExistant.rows[0]!.montant_ajuste);
  }
  const sommeBrute = await client.query<{ total: string | null }>(
    `SELECT SUM(montant) AS total FROM calculs_tva_lignes WHERE calcul_id = $1 AND categorie = ANY($2)`,
    [calculId, CATEGORIES_PAR_TYPE_MONTANT[typeMontant]]
  );
  return sommeBrute.rows[0]?.total ? Number.parseFloat(sommeBrute.rows[0].total) : 0;
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

  const res = await client.query<{
    dossier_id: string;
    periode: string;
    details: { montantTTC?: number } | null;
  }>(
    `UPDATE anomalies SET statut = $2, traite_par = $3, date_traitement = now(),
       commentaire_traitement = $4, resolution = $5
     WHERE id = $1 AND type_anomalie = 'encaissement_non_affecte' AND statut = 'ouvert'
     RETURNING dossier_id, periode, details`,
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

  // Ajustement automatique (10/08, décision de Rami — option A) : si un
  // calcul brouillon existe déjà pour la période de cette anomalie,
  // applique immédiatement la TVA correspondante, sans attendre un
  // nouveau cycle complet. Réutilise exactement le même mécanisme que
  // l'ajustement manuel (ajusterMontantCalcul) — apparaît côté interface
  // comme un ajustement ordinaire, avec une justification générée
  // automatiquement. Si aucun calcul brouillon n'existe encore pour cette
  // période, ne fait rien de plus ici : le mécanisme existant
  // (listerRegularisationsAIntegrer, au moment d'un futur cycle) prendra
  // le relais normalement, comme avant cette extension.
  if (qualification.decision === 'vente' && ligne.details && typeof ligne.details.montantTTC === 'number') {
    const calculRes = await client.query<{ id: string }>(
      `SELECT id FROM calculs_tva WHERE dossier_id = $1 AND periode_debut = $2 AND statut = 'brouillon'`,
      [ligne.dossier_id, ligne.periode]
    );
    const calculId = calculRes.rows[0]?.id;
    if (calculId) {
      const montantTva = ligne.details.montantTTC - ligne.details.montantTTC / (1 + qualification.taux / 100);
      const collecteeActuelle = await calculerMontantActuelPourType(client, calculId, 'collectee_totale');
      await ajusterMontantCalcul(
        client,
        calculId,
        'collectee_totale',
        collecteeActuelle,
        collecteeActuelle + montantTva,
        `Encaissement du compte d'attente qualifié comme vente au taux de ${qualification.taux}% ` +
          `(${montantTva.toFixed(2)} € de TVA sur ${ligne.details.montantTTC.toFixed(2)} € TTC).`,
        utilisateurId
      );
    }
  }
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
  // Bug réel corrigé le 10/08 : une liste vidée par retraits successifs
  // restait marquée "confirmed" pour toujours, sans plus aucun compte
  // dedans — trompeur côté interface. Une liste vide n'a plus de sens à
  // afficher comme confirmée, on repasse à 'rejected' (garde la trace,
  // contrairement à une suppression pure de la ligne).
  const nouveauStatut = nouvelleValeur.length === 0 ? 'rejected' : 'confirmed';
  await client.query(`UPDATE conventions_dossier SET valeur = $2, statut = $3 WHERE id = $1`, [
    ligne.id,
    JSON.stringify(nouvelleValeur),
    nouveauStatut,
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

export class AnomaliesBloquantesNonResoluesError extends Error {
  constructor(public readonly nombre: number) {
    super(
      `Impossible de valider : ${nombre} anomalie(s) bloquante(s) encore ouverte(s) sur cette période. ` +
        `Résolvez-les d'abord dans le panneau Anomalies.`
    );
    this.name = 'AnomaliesBloquantesNonResoluesError';
  }
}

// Passe le calcul en 'valide' — le trigger d'immuabilité (002) garantit que
// plus rien ne peut modifier son montant après ce point. Depuis le 10/08,
// c'est ICI que vit le vrai blocage des anomalies bloquantes — plus à la
// production du brouillon (cf. pipeline.ts), qui se produit désormais
// toujours. Jamais un chiffre incertain ne devient officiel/déclarable
// sans que les anomalies critiques de la période soient résolues.
export async function validerCalcul(
  client: PoolClient,
  calculId: string,
  utilisateurId: string
): Promise<void> {
  const calcul = await client.query<{ dossier_id: string; periode_debut: string }>(
    `SELECT dossier_id, periode_debut FROM calculs_tva WHERE id = $1`,
    [calculId]
  );
  if (calcul.rows.length === 0) {
    throw new CalculPasEnBrouillonError(calculId);
  }
  const { dossier_id: dossierId, periode_debut: periodeDebut } = calcul.rows[0]!;

  const bloquantes = await client.query<{ count: string }>(
    `SELECT count(*) FROM anomalies WHERE dossier_id = $1 AND periode = $2 AND statut = 'ouvert' AND gravite = 'bloquant'`,
    [dossierId, periodeDebut]
  );
  const nombreBloquantes = Number.parseInt(bloquantes.rows[0]!.count, 10);
  if (nombreBloquantes > 0) {
    throw new AnomaliesBloquantesNonResoluesError(nombreBloquantes);
  }

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
  | 'autoliquide_5.5'
  // Plusieurs taux légitimement appliqués sur ce compte selon les cas
  // (10/08) — n'affecte aujourd'hui que la suggestion (ce compte n'est
  // plus proposé une fois assigné, quelle que soit la valeur), aucun
  // contrôle ne compare ce taux à autre chose pour l'instant.
  | 'mixte';

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
//
// 'mixte' (10/08) : le client applique plusieurs taux légitimement selon
// les cas — jamais de taux par défaut fixe pour ce compte. Stocké comme
// NULL en base (colonne rendue nullable en migration 011), filtré à la
// lecture (dossierRepository.ts) pour ne jamais entrer dans
// tauxHistorique[] — le chantier B retombe alors automatiquement sur sa
// prudence habituelle (20%), sans aucun changement de sa propre logique.
export async function assignerTauxHistoriqueTiersManuel(
  client: PoolClient,
  dossierId: string,
  numeroCompteTiers: string,
  tauxHabituel: number | 'mixte',
  utilisateurId: string
): Promise<void> {
  const valeurStockee = tauxHabituel === 'mixte' ? null : tauxHabituel;
  await client.query(
    `INSERT INTO taux_historique_tiers (dossier_id, numero_compte_tiers, taux_habituel, nb_occurrences, statut, source, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, 0, 'confirmed', 'saisie_manuelle', $4, now())
     ON CONFLICT (dossier_id, numero_compte_tiers) WHERE statut = 'confirmed'
     DO UPDATE SET taux_habituel = EXCLUDED.taux_habituel, source = 'saisie_manuelle',
                    confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now(), derniere_maj = now()`,
    [dossierId, numeroCompteTiers, valeurStockee, utilisateurId]
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
  // Optionnel (10/08) — prépare le chantier correspondance carburant/
  // véhicule, pas encore construit. NULL = non renseigné, aucun effet sur
  // le calcul tant que ce contrôle n'existe pas.
  typeCarburant?: 'diesel' | 'essence';
}

export async function ajouterVehiculeManuel(
  client: PoolClient,
  dossierId: string,
  vehicule: VehiculeManuel,
  utilisateurId: string
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO immobilisations (dossier_id, compte, designation, montant_ht, date_acquisition, type_bien, type_carburant, statut, source, confirmed_by, confirmed_at)
     VALUES ($1, '2182', $2, $3, $4, $5, $6, 'confirmed', 'saisie_manuelle', $7, now())
     RETURNING id`,
    [
      dossierId,
      vehicule.designation ?? null,
      vehicule.montantHt ?? null,
      vehicule.dateAcquisition ?? null,
      vehicule.typeBien,
      vehicule.typeCarburant ?? null,
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
    details: { immobilisationId: id, typeBien: vehicule.typeBien, typeCarburant: vehicule.typeCarburant ?? null, designation: vehicule.designation },
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

// ============================================================================
// AJUSTEMENT MANUEL DES MONTANTS DE TVA (10/08)
// ============================================================================

export class CalculPlusEnBrouillonError extends Error {
  constructor(calculId: string) {
    super(
      `Calcul ${calculId} : introuvable ou plus en statut 'brouillon' — un ajustement manuel n'est possible ` +
        `que sur un calcul encore en brouillon.`
    );
    this.name = 'CalculPlusEnBrouillonError';
  }
}

// Additif, jamais un remplacement (cf. migration 012) — calculs_tva et
// calculs_tva_lignes restent intouchés, cette table est une couche
// séparée combinée au résultat d'origine uniquement à l'affichage.
//
// montantOriginal n'est écrit que lors du tout premier ajustement pour ce
// (calcul, type) — un ré-ajustement met à jour montant_ajuste et la
// justification, mais montant_original reste celui du tout premier appel :
// il doit toujours représenter ce que le moteur de calcul a produit, pas
// la valeur juste avant le dernier ajustement.
export async function ajusterMontantCalcul(
  client: PoolClient,
  calculId: string,
  typeMontant: 'collectee_totale' | 'deductible_totale',
  montantOriginal: number,
  montantAjuste: number,
  justification: string,
  utilisateurId: string
): Promise<void> {
  const calcul = await client.query<{ statut: string; dossier_id: string }>(
    `SELECT statut, dossier_id FROM calculs_tva WHERE id = $1`,
    [calculId]
  );
  if (calcul.rows.length === 0 || calcul.rows[0]!.statut !== 'brouillon') {
    throw new CalculPlusEnBrouillonError(calculId);
  }

  await client.query(
    `INSERT INTO ajustements_calcul (calcul_id, type_montant, montant_original, montant_ajuste, justification, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (calcul_id, type_montant)
     DO UPDATE SET montant_ajuste = EXCLUDED.montant_ajuste, justification = EXCLUDED.justification,
                    created_at = now(), created_by = EXCLUDED.created_by`,
    [calculId, typeMontant, montantOriginal, montantAjuste, justification, utilisateurId]
  );

  await enregistrerEvenementAudit(client, {
    dossierId: calcul.rows[0]!.dossier_id,
    typeEvenement: 'montant_calcul_ajuste',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { calculId, typeMontant, montantOriginal, montantAjuste, justification },
  });
}

// Retire un ajustement — le montant redevient celui calculé par le moteur,
// sans qu'il soit nécessaire de relancer un cycle.
export async function retirerAjustementCalcul(
  client: PoolClient,
  calculId: string,
  typeMontant: 'collectee_totale' | 'deductible_totale',
  utilisateurId: string
): Promise<void> {
  const calcul = await client.query<{ statut: string; dossier_id: string }>(
    `SELECT statut, dossier_id FROM calculs_tva WHERE id = $1`,
    [calculId]
  );
  if (calcul.rows.length === 0 || calcul.rows[0]!.statut !== 'brouillon') {
    throw new CalculPlusEnBrouillonError(calculId);
  }

  await client.query(`DELETE FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = $2`, [
    calculId,
    typeMontant,
  ]);

  await enregistrerEvenementAudit(client, {
    dossierId: calcul.rows[0]!.dossier_id,
    typeEvenement: 'ajustement_calcul_retire',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { calculId, typeMontant },
  });
}

// ============================================================================
// AUTHENTIFICATION (10/08)
// ============================================================================

// Restreint au cabinet courant via RLS (utilisateurs a du RLS forcé) — pas
// de vérification manuelle nécessaire, appelé via avecContexteCabinet côté
// appelant (app.ts), donc seul un utilisateur du cabinet de l'acteur peut
// être modifié.
export async function definirMotDePasse(
  client: PoolClient,
  utilisateurId: string,
  motDePasseHash: string
): Promise<void> {
  const res = await client.query(`UPDATE utilisateurs SET mot_de_passe_hash = $2 WHERE id = $1`, [
    utilisateurId,
    motDePasseHash,
  ]);
  if (res.rowCount === 0) {
    throw new Error(`Utilisateur ${utilisateurId} introuvable, ou hors du cabinet courant.`);
  }
}

export class EmailDejaUtiliseError extends Error {
  constructor(email: string) {
    super(`Un utilisateur existe déjà avec l'email ${email}.`);
    this.name = 'EmailDejaUtiliseError';
  }
}

// Crée un nouveau collaborateur ou admin_cabinet dans le cabinet courant
// (RLS classique, via avecContexteCabinet côté appelant) — avec un mot de
// passe défini dès la création, pas de flux en deux temps. C'est ce qui
// permet à un cabinet de gérer lui-même l'arrivée d'un nouveau
// collaborateur sans jamais repasser par du SQL direct.
export async function creerUtilisateurCabinet(
  client: PoolClient,
  cabinetId: string,
  nom: string,
  email: string,
  role: 'collaborateur' | 'admin_cabinet',
  motDePasseHash: string
): Promise<string> {
  try {
    const res = await client.query<{ id: string }>(
      `INSERT INTO utilisateurs (cabinet_id, nom, email, role, mot_de_passe_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cabinetId, nom, email, role, motDePasseHash]
    );
    return res.rows[0]!.id;
  } catch (err) {
    // Contrainte unique sur email (si elle existe) — remonte une erreur
    // métier claire plutôt que l'erreur Postgres brute.
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw new EmailDejaUtiliseError(email);
    }
    throw err;
  }
}

export class DernierAdminCabinetError extends Error {
  constructor() {
    super(
      "Impossible de désactiver ce compte : c'est le dernier administrateur du cabinet. " +
        'Il doit en rester au moins un pour gérer les paramètres du cabinet.'
    );
    this.name = 'DernierAdminCabinetError';
  }
}

// Désactive plutôt que supprimer (10/08) — statut='inactif', jamais un
// DELETE : plusieurs tables référencent utilisateurs.id sans ON DELETE
// CASCADE (audit_log, confirmed_by des conventions et taux, calculs
// validés...), une vraie suppression échouerait de toute façon pour un
// utilisateur ayant déjà agi. Un compte inactif ne peut déjà plus se
// connecter (vérifié à /auth/login), donc le résultat pratique est le
// même sans perdre la trace des actions passées.
//
// Garde-fou : jamais désactiver le dernier admin_cabinet d'un cabinet,
// sinon plus personne ne peut gérer les paramètres du cabinet ni les
// autres utilisateurs.
export async function desactiverUtilisateurCabinet(
  client: PoolClient,
  cabinetId: string,
  utilisateurId: string
): Promise<void> {
  const cible = await client.query<{ role: string }>(`SELECT role FROM utilisateurs WHERE id = $1`, [
    utilisateurId,
  ]);
  if (cible.rows.length === 0) {
    throw new Error(`Utilisateur ${utilisateurId} introuvable, ou hors du cabinet courant.`);
  }

  if (cible.rows[0]!.role === 'admin_cabinet') {
    const compte = await client.query<{ count: string }>(
      `SELECT count(*) FROM utilisateurs WHERE cabinet_id = $1 AND role = 'admin_cabinet' AND statut = 'actif'`,
      [cabinetId]
    );
    if (Number.parseInt(compte.rows[0]!.count, 10) <= 1) {
      throw new DernierAdminCabinetError();
    }
  }

  await client.query(`UPDATE utilisateurs SET statut = 'inactif' WHERE id = $1`, [utilisateurId]);
}

// ============================================================================
// SYNCHRONISATION DES DOSSIERS DEPUIS L'API CABINET (10/08)
// ============================================================================

export interface DossierSynchronise {
  id: string;
  nom: string;
  nouveau: boolean; // true si cette synchronisation vient de le créer
}

// Auto-découverte des dossiers du cabinet (chantier connecteur Firm API,
// 10/08) — répond directement à la question de Rami sur l'onboarding : un
// dossier déjà présent chez Pennylane apparaît automatiquement, sans import
// CSV ni FEC.
//
// Un dossier NOUVEAU est créé avec statut='onboarding' (déjà la valeur par
// défaut du schéma, cf. 001_schema_initial.sql — cette table anticipait
// déjà ce flux sans qu'il ait jamais été construit) et regime_tva à
// 'reel_normal' par défaut : une vraie hypothèse, PAS une vérité fiscale
// vérifiée — à confirmer par un humain avant qu'un premier cycle ne soit
// lancé sur ce dossier (chantier "Phase 2", pas encore construit).
//
// Un dossier DÉJÀ CONNU (même cabinet + même logiciel_source +
// même external_company_id, la contrainte unique du schéma) n'est mis à
// jour que sur nom/siren — jamais sur regime_tva, tva_encaissement, ni
// statut, pour ne jamais écraser une configuration humaine déjà faite.
export async function synchroniserDossiersCabinet(
  client: PoolClient,
  cabinetId: string,
  dossiersDecouverts: {
    id: string;
    nom: string;
    siren: string | null;
    nomCommercial?: string | null;
    adresse?: string | null;
    ville?: string | null;
    codePostal?: string | null;
    codeNaf?: string | null;
    codeClient?: string | null;
  }[]
): Promise<DossierSynchronise[]> {
  const resultat: DossierSynchronise[] = [];

  for (const d of dossiersDecouverts) {
    const res = await client.query<{ id: string; xmax: string }>(
      `INSERT INTO dossiers (
         cabinet_id, nom, siren, regime_tva, logiciel_source, external_company_id, tva_encaissement,
         nom_commercial, adresse, ville, code_postal, code_naf, code_client_pennylane
       )
       VALUES ($1, $2, $3, 'reel_normal', 'pennylane', $4, false, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (cabinet_id, logiciel_source, external_company_id)
       DO UPDATE SET
         nom = EXCLUDED.nom, siren = EXCLUDED.siren,
         nom_commercial = EXCLUDED.nom_commercial, adresse = EXCLUDED.adresse,
         ville = EXCLUDED.ville, code_postal = EXCLUDED.code_postal,
         code_naf = EXCLUDED.code_naf, code_client_pennylane = EXCLUDED.code_client_pennylane,
         updated_at = now()
       RETURNING id, xmax::text`,
      [
        cabinetId,
        d.nom,
        d.siren,
        d.id,
        d.nomCommercial ?? null,
        d.adresse ?? null,
        d.ville ?? null,
        d.codePostal ?? null,
        d.codeNaf ?? null,
        d.codeClient ?? null,
      ]
    );
    // xmax = '0' uniquement pour une ligne fraîchement insérée par CETTE
    // requête (jamais mise à jour) — distingue "nouveau" de "déjà connu,
    // juste rafraîchi" sans requête supplémentaire.
    resultat.push({ id: res.rows[0]!.id, nom: d.nom, nouveau: res.rows[0]!.xmax === '0' });
  }

  return resultat;
}

// ============================================================================
// CONFIGURATION D'UN DOSSIER NOUVELLEMENT DÉCOUVERT (Phase 2, 10/08)
// ============================================================================

export class DossierIntrouvableError extends Error {
  constructor(dossierId: string) {
    super(`Dossier ${dossierId} introuvable, ou hors du cabinet courant.`);
    this.name = 'DossierIntrouvableError';
  }
}

// Un dossier synchronisé depuis l'API Cabinet arrive avec regime_tva
// forcé à 'reel_normal' par défaut (une hypothèse, jamais une vérité
// fiscale) et statut='onboarding' — ce contrôle rapide confirme les vrais
// choix humains et fait passer le dossier à 'actif', le rendant
// utilisable pour un vrai cycle. Peut aussi être appelé sur un dossier
// déjà actif pour corriger sa configuration — pas restreint aux seuls
// dossiers en onboarding.
export async function configurerDossierOnboarding(
  client: PoolClient,
  dossierId: string,
  regimeTva: 'reel_normal' | 'reel_simplifie' | 'franchise',
  periodiciteDeclaration: 'mensuelle' | 'trimestrielle',
  tvaEncaissement: boolean
): Promise<void> {
  const res = await client.query(
    `UPDATE dossiers
     SET regime_tva = $2, periodicite_declaration = $3, tva_encaissement = $4,
         statut = 'actif', date_onboarding = COALESCE(date_onboarding, now())
     WHERE id = $1
     RETURNING id`,
    [dossierId, regimeTva, periodiciteDeclaration, tvaEncaissement]
  );
  if (res.rowCount === 0) {
    throw new DossierIntrouvableError(dossierId);
  }
}

// ============================================================================
// ACTIVATION / DÉSACTIVATION D'UN DOSSIER, AVEC MOTIF (10/08)
// ============================================================================

// Réservé à admin_cabinet côté route (pas vérifié ici, c'est à l'appelant
// de le faire) — deux raisons distinctes identifiées par Rami : un dossier
// découvert par erreur lors d'un import en masse (hors périmètre TVA), ou
// un dossier volontairement écarté (trop complexe, régime spécial). Le
// motif garde la trace de laquelle s'applique, en texte libre.
export async function definirStatutDossier(
  client: PoolClient,
  dossierId: string,
  statut: 'actif' | 'inactif',
  motifDesactivation?: string | null
): Promise<void> {
  const res = await client.query(
    `UPDATE dossiers SET statut = $2, motif_desactivation = $3 WHERE id = $1 RETURNING id`,
    [dossierId, statut, statut === 'inactif' ? (motifDesactivation ?? null) : null]
  );
  if (res.rowCount === 0) {
    throw new DossierIntrouvableError(dossierId);
  }
}

// ============================================================================
// INFORMATIONS D'IDENTITÉ D'UN DOSSIER (10/08)
// ============================================================================

export interface InfosIdentiteDossier {
  siret?: string | null;
  formeJuridique?: string | null;
  fiscalite?: 'is' | 'ir' | null;
  comptabilite?: 'engagement' | 'tresorerie' | null;
  dateDebutExercice?: string | null; // 'YYYY-MM-DD'
  dateFinExercice?: string | null;
  emailContact?: string | null;
  contactNom?: string | null;
  contactTelephone?: string | null;
  numeroTvaIntracom?: string | null;
}

// Mise à jour partielle — seuls les champs présents dans infos sont
// modifiés, undefined laisse la valeur existante intacte (distinct de
// null, qui efface explicitement). Accessible aux deux rôles (dossier,
// pas cabinet), contrairement à definirStatutDossier.
export async function mettreAJourInfosDossier(
  client: PoolClient,
  dossierId: string,
  infos: InfosIdentiteDossier
): Promise<void> {
  const colonnes: Record<keyof InfosIdentiteDossier, string> = {
    siret: 'siret',
    formeJuridique: 'forme_juridique',
    fiscalite: 'fiscalite',
    comptabilite: 'comptabilite',
    dateDebutExercice: 'date_debut_exercice',
    dateFinExercice: 'date_fin_exercice',
    emailContact: 'email_contact',
    contactNom: 'contact_nom',
    contactTelephone: 'contact_telephone',
    numeroTvaIntracom: 'numero_tva_intracom',
  };

  const cles = (Object.keys(infos) as (keyof InfosIdentiteDossier)[]).filter((k) => infos[k] !== undefined);
  if (cles.length === 0) return; // rien à faire, jamais une erreur

  const affectations = cles.map((k, i) => `${colonnes[k]} = $${i + 2}`).join(', ');
  const valeurs = cles.map((k) => infos[k]);

  const res = await client.query(`UPDATE dossiers SET ${affectations} WHERE id = $1 RETURNING id`, [
    dossierId,
    ...valeurs,
  ]);
  if (res.rowCount === 0) {
    throw new DossierIntrouvableError(dossierId);
  }
}

// ============================================================================
// RAPPROCHEMENTS DE PAIEMENT ACHATS — validation manuelle (10/08)
// ============================================================================

export interface PaiementValide {
  ledgerEntryId: number;
  montant: number;
}

export class PaiementDejaReclameError extends Error {
  constructor(public readonly ledgerEntryId: number, public readonly autreFactureId: number) {
    super(
      `Le paiement ${ledgerEntryId} est déjà rattaché à la facture ${autreFactureId} — ` +
        `un même paiement ne peut jamais être compté pour deux factures différentes.`
    );
    this.name = 'PaiementDejaReclameError';
  }
}

// Enregistre le choix du collaborateur — jamais celui du LLM seul, qui n'a
// fait que précocher une proposition (cf. jugerCandidatsPaiementAchat,
// connector-mistral). paiementsValides peut être un tableau vide : le
// collaborateur peut valider "aucun de ces paiements ne correspond",
// ce qui referme quand même la facture (exclue par prudence — aucun
// paiement rattaché, donc rien à déduire cette période).
//
// Garde-fou (10/08, demande de Rami) : un paiement déjà rattaché à une
// AUTRE facture (peu importe la période — la fenêtre de recherche couvre
// tout l'exercice) est refusé ici, en plus d'être déjà exclu des
// candidats proposés côté lecture (preparerRapprochementsPaiementAchat) —
// double garantie, jamais un simple filtrage côté affichage seul.
export async function enregistrerRapprochementPaiementAchat(
  client: PoolClient,
  dossierId: string,
  periode: string,
  factureLedgerEntryId: number,
  montantFactureTotal: number,
  paiementsValides: PaiementValide[],
  utilisateurId: string
): Promise<void> {
  if (paiementsValides.length > 0) {
    const autresFactures = await client.query<{ facture_ledger_entry_id: string; paiements_valides: PaiementValide[] }>(
      `SELECT facture_ledger_entry_id, paiements_valides FROM rapprochements_paiement_achat
       WHERE dossier_id = $1 AND facture_ledger_entry_id != $2`,
      [dossierId, factureLedgerEntryId]
    );
    for (const nouveauPaiement of paiementsValides) {
      for (const autre of autresFactures.rows) {
        if (autre.paiements_valides.some((p) => p.ledgerEntryId === nouveauPaiement.ledgerEntryId)) {
          throw new PaiementDejaReclameError(nouveauPaiement.ledgerEntryId, Number(autre.facture_ledger_entry_id));
        }
      }
    }
  }

  const montantTotalValide = paiementsValides.reduce((s, p) => s + p.montant, 0);

  await client.query(
    `INSERT INTO rapprochements_paiement_achat
       (dossier_id, periode, facture_ledger_entry_id, montant_facture_total, paiements_valides, montant_total_valide, confirmed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dossier_id, facture_ledger_entry_id)
     DO UPDATE SET
       periode = EXCLUDED.periode,
       montant_facture_total = EXCLUDED.montant_facture_total,
       paiements_valides = EXCLUDED.paiements_valides,
       montant_total_valide = EXCLUDED.montant_total_valide,
       confirmed_by = EXCLUDED.confirmed_by,
       confirmed_at = now()`,
    [
      dossierId,
      periode,
      factureLedgerEntryId,
      montantFactureTotal,
      JSON.stringify(paiementsValides),
      montantTotalValide,
      utilisateurId,
    ]
  );

  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'rapprochement_paiement_achat_valide',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { factureLedgerEntryId, montantFactureTotal, paiementsValides, montantTotalValide },
  });
}

// Résolution automatique (10/08, demande de Rami) : une facture sans
// AUCUN paiement candidat n'a rien à faire décider au collaborateur —
// on sait déjà que rien n'est déductible. Jamais confirmed_by (NULL),
// pour distinguer clairement une résolution automatique d'une vraie
// décision humaine dans l'historique. Idempotent via le même ON CONFLICT
// que la résolution manuelle — un appel répété (popup rechargé) ne créé
// jamais de doublon ni d'événement d'audit répété inutilement.
export async function autoResoudreFactureSansCandidat(
  client: PoolClient,
  dossierId: string,
  periode: string,
  factureLedgerEntryId: number,
  montantFactureTotal: number
): Promise<void> {
  const res = await client.query<{ xmax: string }>(
    `INSERT INTO rapprochements_paiement_achat
       (dossier_id, periode, facture_ledger_entry_id, montant_facture_total, paiements_valides, montant_total_valide, confirmed_by)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, 0, NULL)
     ON CONFLICT (dossier_id, facture_ledger_entry_id) DO NOTHING
     RETURNING xmax::text`,
    [dossierId, periode, factureLedgerEntryId, montantFactureTotal]
  );
  if (res.rows.length === 0) return; // déjà résolue (manuellement ou automatiquement), rien à refaire

  await enregistrerEvenementAudit(client, {
    dossierId,
    typeEvenement: 'rapprochement_paiement_achat_auto_resolu',
    moduleSource: 'module9_orchestrateur',
    acteur: 'systeme',
    details: { factureLedgerEntryId, montantFactureTotal, motif: 'aucun paiement candidat trouvé' },
  });
}

// ============================================================================
// CORRECTION D'UN AVOIR/OD (10/08, mécanisme "Vérifier à nouveau")
// ============================================================================

// Applique un delta (pas un montant absolu) sur le calcul brouillon
// existant, une fois qu'un avoir_a_verifier a été confirmé corrigé côté
// Pennylane — même principe que l'ajustement automatique déjà construit
// pour encaissement_non_affecte. Si aucun brouillon n'existe pour cette
// période, ne fait rien de plus : le prochain cycle intégrera
// naturellement la correction, plus besoin de rattraper après coup.
export async function appliquerCorrectionAvoir(
  client: PoolClient,
  dossierId: string,
  periode: string,
  sens: 'collecte' | 'deductible',
  delta: number,
  description: string,
  utilisateurId: string
): Promise<void> {
  if (delta === 0) return; // rien à ajuster

  const calcul = await client.query<{ id: string }>(
    `SELECT id FROM calculs_tva WHERE dossier_id = $1 AND periode_debut = $2 AND statut = 'brouillon'`,
    [dossierId, periode]
  );
  const calculId = calcul.rows[0]?.id;
  if (!calculId) return;

  const typeMontant = sens === 'collecte' ? 'collectee_totale' : 'deductible_totale';
  const montantActuel = await calculerMontantActuelPourType(client, calculId, typeMontant);
  await ajusterMontantCalcul(client, calculId, typeMontant, montantActuel, montantActuel + delta, description, utilisateurId);
}

// ============================================================================
// QUALIFICATION D'UN AVOIR/OD (10/08) — choix structuré, pas du texte libre
// ============================================================================

// Résolution structurée demandée par Rami : le collaborateur confirme
// précisément s'il s'agit d'un avoir ou d'une OD de régularisation —
// jamais un simple commentaire libre. N'affecte jamais le calcul (rien à
// ajuster ici, contrairement à verifierAvoirsLegere) : cette qualification
// documente seulement CE QUE C'EST, une correction éventuelle d'une
// vraie erreur passe par "Vérifier à nouveau", pas par cette résolution.
export async function qualifierAvoir(
  client: PoolClient,
  anomalieId: string,
  utilisateurId: string,
  type: 'avoir' | 'od'
): Promise<void> {
  const res = await client.query<{ dossier_id: string }>(
    `UPDATE anomalies SET statut = 'resolu', traite_par = $2, date_traitement = now(), resolution = $3
     WHERE id = $1 AND type_anomalie = 'avoir_a_verifier' AND statut = 'ouvert'
     RETURNING dossier_id`,
    [anomalieId, utilisateurId, JSON.stringify({ type })]
  );
  const ligne = res.rows[0];
  if (!ligne) {
    throw new AnomalieNonQualifiableError(anomalieId);
  }
  await enregistrerEvenementAudit(client, {
    dossierId: ligne.dossier_id,
    typeEvenement: 'avoir_qualifie',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { anomalieId, type },
  });
}
