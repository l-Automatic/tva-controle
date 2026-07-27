import type { PoolClient } from 'pg';
import type { Anomalie } from '@tva-controle/core';
import type { PropositionConvention } from '@tva-controle/onboarding-module3';
import type { PropositionTaux } from '@tva-controle/onboarding-module3';
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
  // silencieuse). Seules les anomalies encore 'ouvert' sont purgées : une
  // anomalie déjà 'resolu'/'justifie' est une décision humaine, elle reste
  // en base comme trace même si le contrôle ne la redétecte plus.
  await client.query(`DELETE FROM anomalies WHERE dossier_id = $1 AND periode = $2 AND statut = 'ouvert'`, [
    dossierId,
    periode,
  ]);

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

export async function enregistrerPropositionsTaux(
  client: PoolClient,
  dossierId: string,
  propositions: PropositionTaux[]
): Promise<void> {
  for (const p of propositions) {
    await client.query(
      `INSERT INTO taux_historique (dossier_id, compte_produit_ou_charge, taux_habituel, nb_occurrences, statut, source)
       VALUES ($1, $2, $3, $4, 'candidate', 'onboarding')`,
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
// CALCUL TVA
// ============================================================================

// Levée quand un cycle est relancé sur une période dont le calcul a déjà
// été 'valide' ou 'declare'. Le trigger d'immuabilité (002) ne protège que
// les UPDATE sur calculs_tva/calculs_tva_lignes, pas les DELETE : c'est donc
// à cette fonction de vérifier le statut avant toute suppression, plutôt que
// de compter sur la DB pour empêcher d'effacer un calcul déjà validé.
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
  if (existant.rows.length > 0) {
    const { id, statut } = existant.rows[0]!;
    if (statut !== 'brouillon') {
      throw new CalculDejaValideError(statut);
    }
    // Brouillon existant : on le remplace proprement. Les lignes doivent être
    // supprimées avant le header (le trigger de protection des lignes
    // vérifie le statut du header parent, qui doit encore exister à ce
    // moment-là pour renvoyer 'brouillon' et laisser passer le DELETE).
    await client.query(`DELETE FROM calculs_tva_lignes WHERE calcul_id = $1`, [id]);
    await client.query(`DELETE FROM calculs_tva WHERE id = $1`, [id]);
  }

  const resCalcul = await client.query<{ id: string }>(
    `INSERT INTO calculs_tva (dossier_id, periode_debut, periode_fin, statut, tva_nette, sens)
     VALUES ($1, $2, $3, 'brouillon', $4, $5)
     RETURNING id`,
    [dossierId, periodeDebut, periodeFin, resultat.tvaNette, resultat.sens]
  );
  const calculId = resCalcul.rows[0]!.id;

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

// Passe le calcul en 'valide' — le trigger d'immuabilité (002) garantit que
// plus rien ne peut modifier son montant après ce point.
export async function validerCalcul(
  client: PoolClient,
  calculId: string,
  utilisateurId: string
): Promise<void> {
  const res = await client.query<{ dossier_id: string; tva_nette: string; sens: string }>(
    `UPDATE calculs_tva SET statut = 'valide', valide_par = $2, date_validation = now() WHERE id = $1
     RETURNING dossier_id, tva_nette, sens`,
    [calculId, utilisateurId]
  );
  const ligne = res.rows[0];
  await enregistrerEvenementAudit(client, {
    dossierId: ligne?.dossier_id ?? null,
    typeEvenement: 'calcul_valide',
    moduleSource: 'module6_validation',
    acteur: 'utilisateur',
    acteurUtilisateurId: utilisateurId,
    details: { calculId, tvaNette: ligne?.tva_nette, sens: ligne?.sens },
  });
}
