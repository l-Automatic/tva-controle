import type { PoolClient } from 'pg';

export interface AnomalieDb {
  id: string;
  dossierId: string;
  periode: string;
  typeAnomalie: string;
  gravite: 'bloquant' | 'signale' | 'info';
  referencePiece: string | null;
  compte: string | null;
  description: string;
  details: unknown;
  statut: 'ouvert' | 'resolu' | 'justifie' | 'obsolete';
  resolution: unknown;
  createdAt: string;
}

export async function listerAnomalies(
  client: PoolClient,
  dossierId: string,
  filtres: { statut?: string; periode?: string } = {}
): Promise<AnomalieDb[]> {
  const conditions = ['dossier_id = $1'];
  const params: unknown[] = [dossierId];

  if (filtres.statut) {
    params.push(filtres.statut);
    conditions.push(`statut = $${params.length}`);
  } else {
    // 'obsolete' est un statut de bookkeeping interne (anomalie remplacée
    // par une relance de cycle, cf. writeRepository.enregistrerAnomalies) :
    // jamais destiné à l'affichage humain, donc exclu par défaut. Reste
    // consultable explicitement via filtres.statut = 'obsolete' au besoin.
    conditions.push(`statut != 'obsolete'`);
  }
  if (filtres.periode) {
    params.push(filtres.periode);
    conditions.push(`periode = $${params.length}`);
  }

  const res = await client.query(
    `SELECT id, dossier_id, periode, type_anomalie, gravite, reference_piece, compte, description, details, statut, resolution, created_at
     FROM anomalies WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    dossierId: r.dossier_id,
    periode: r.periode,
    typeAnomalie: r.type_anomalie,
    gravite: r.gravite,
    referencePiece: r.reference_piece,
    compte: r.compte,
    description: r.description,
    details: r.details,
    statut: r.statut,
    resolution: r.resolution,
    createdAt: r.created_at,
  }));
}

// Ledger entry ids déjà qualifiés (résolus ou justifiés) pour ce dossier —
// sert à ce que la détection (encaissementNonAffecte, stateless, relit les
// mêmes lignes Pennylane à chaque cycle) ne re-signale pas indéfiniment un
// encaissement déjà traité par un humain lors d'un cycle précédent : sans ce
// filtre, la relance d'un cycle re-bloquerait systématiquement sur les mêmes
// pièces déjà qualifiées, dans une boucle sans issue.
export async function listerLedgerEntryIdsQualifies(client: PoolClient, dossierId: string): Promise<Set<number>> {
  const res = await client.query<{ reference_piece: string }>(
    `SELECT reference_piece FROM anomalies
     WHERE dossier_id = $1 AND type_anomalie = 'encaissement_non_affecte'
       AND statut IN ('resolu', 'justifie') AND reference_piece IS NOT NULL`,
    [dossierId]
  );
  return new Set(res.rows.map((r) => Number(r.reference_piece)));
}

export interface RegularisationDb {
  ledgerEntryId: number;
  montantTTC: number;
  taux: number;
}

// Régularisations à intégrer au calcul de la période : encaissements
// 'encaissement_non_affecte' qualifiés 'vente' (statut='resolu', taux dans
// resolution) pour ce dossier et cette période précisément — un encaissement
// qualifié sur une autre période n'a pas à impacter celle-ci.
export async function listerRegularisationsAIntegrer(
  client: PoolClient,
  dossierId: string,
  periode: string
): Promise<RegularisationDb[]> {
  const res = await client.query<{ reference_piece: string; details: { montantTTC: number }; resolution: { taux: number } }>(
    `SELECT reference_piece, details, resolution FROM anomalies
     WHERE dossier_id = $1 AND periode = $2 AND type_anomalie = 'encaissement_non_affecte'
       AND statut = 'resolu' AND resolution IS NOT NULL`,
    [dossierId, periode]
  );
  return res.rows.map((r) => ({
    ledgerEntryId: Number(r.reference_piece),
    montantTTC: Number(r.details.montantTTC),
    taux: Number(r.resolution.taux),
  }));
}

export interface PropositionDb {
  id: string;
  dossierId: string;
  cle?: string | undefined; // conventions_dossier uniquement
  compteProduitOuCharge?: string | undefined; // taux_historique uniquement
  numeroCompteTiers?: string | undefined; // taux_historique_tiers uniquement (chantier B)
  valeur?: unknown;
  tauxHabituel?: number | undefined;
  statut: 'candidate' | 'confirmed' | 'rejected';
  source: string;
  confidenceNote?: string | null | undefined;
}

export async function listerConventions(
  client: PoolClient,
  dossierId: string,
  statut?: string
): Promise<PropositionDb[]> {
  const params: unknown[] = [dossierId];
  let condition = 'dossier_id = $1';
  if (statut) {
    params.push(statut);
    condition += ` AND statut = $2`;
  } else {
    // 'rejected' masqué par défaut : reste consultable en base et via
    // audit_log (traçabilité intacte), mais n'encombre plus l'écran par
    // défaut — même logique que 'obsolete' sur les anomalies (05/08).
    // Demande de Rami (08/08) : cet historique ne sert à rien au quotidien.
    condition += ` AND statut != 'rejected'`;
  }

  const res = await client.query(
    `SELECT id, dossier_id, cle, valeur, statut, source, confidence_note
     FROM conventions_dossier WHERE ${condition} ORDER BY created_at DESC`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    dossierId: r.dossier_id,
    cle: r.cle,
    valeur: r.valeur,
    statut: r.statut,
    source: r.source,
    confidenceNote: r.confidence_note,
  }));
}

export async function listerTauxHistorique(
  client: PoolClient,
  dossierId: string,
  statut?: string
): Promise<PropositionDb[]> {
  const params: unknown[] = [dossierId];
  let condition = 'dossier_id = $1';
  if (statut) {
    params.push(statut);
    condition += ` AND statut = $2`;
  } else {
    condition += ` AND statut != 'rejected'`;
  }

  const res = await client.query(
    `SELECT id, dossier_id, compte_produit_ou_charge, taux_habituel, statut, source
     FROM taux_historique WHERE ${condition} ORDER BY derniere_maj DESC`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    dossierId: r.dossier_id,
    compteProduitOuCharge: r.compte_produit_ou_charge,
    tauxHabituel: r.taux_habituel !== null ? Number.parseFloat(r.taux_habituel) : undefined,
    statut: r.statut,
    source: r.source,
  }));
}

export async function listerTauxHistoriqueTiers(
  client: PoolClient,
  dossierId: string,
  statut?: string
): Promise<PropositionDb[]> {
  const params: unknown[] = [dossierId];
  let condition = 'dossier_id = $1';
  if (statut) {
    params.push(statut);
    condition += ` AND statut = $2`;
  } else {
    condition += ` AND statut != 'rejected'`;
  }

  const res = await client.query(
    `SELECT id, dossier_id, numero_compte_tiers, taux_habituel, statut, source
     FROM taux_historique_tiers WHERE ${condition} ORDER BY derniere_maj DESC`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    dossierId: r.dossier_id,
    numeroCompteTiers: r.numero_compte_tiers,
    tauxHabituel: r.taux_habituel !== null ? Number.parseFloat(r.taux_habituel) : undefined,
    statut: r.statut,
    source: r.source,
  }));
}

export interface TiersReferenceDb {
  numeroCompteTiers: string;
  nomTiers: string | null;
  niveauConfiance: 'nouveau' | 'a_surveiller' | 'confiance';
  nbControlesSansAnomalie: number;
  derniereDateControle: string | null;
}

export async function listerTiersReference(client: PoolClient, dossierId: string): Promise<TiersReferenceDb[]> {
  const res = await client.query(
    `SELECT numero_compte_tiers, nom_tiers, niveau_confiance, nb_controles_sans_anomalie, derniere_date_controle
     FROM tiers_reference WHERE dossier_id = $1 ORDER BY nb_controles_sans_anomalie DESC`,
    [dossierId]
  );
  return res.rows.map((r) => ({
    numeroCompteTiers: r.numero_compte_tiers,
    nomTiers: r.nom_tiers,
    niveauConfiance: r.niveau_confiance,
    nbControlesSansAnomalie: r.nb_controles_sans_anomalie,
    derniereDateControle: r.derniere_date_controle,
  }));
}

export interface CalculDb {
  id: string;
  periodeDebut: string;
  periodeFin: string;
  statut: 'brouillon' | 'valide' | 'declare' | 'rejete';
  tvaNette: number;
  sens: 'a_decaisser' | 'credit';
}

export async function listerCalculs(client: PoolClient, dossierId: string): Promise<CalculDb[]> {
  const res = await client.query(
    `SELECT id, periode_debut, periode_fin, statut, tva_nette, sens
     FROM calculs_tva WHERE dossier_id = $1 ORDER BY periode_debut DESC`,
    [dossierId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    periodeDebut: r.periode_debut,
    periodeFin: r.periode_fin,
    statut: r.statut,
    tvaNette: Number.parseFloat(r.tva_nette),
    sens: r.sens,
  }));
}

// ============================================================================
// AUDIT (Module 10)
// ============================================================================

export interface AuditEvenementDb {
  id: string;
  dossierId: string | null;
  typeEvenement: string;
  moduleSource: string;
  acteur: 'agent' | 'utilisateur' | 'systeme';
  acteurUtilisateurId: string | null;
  acteurNom: string | null; // null si acteur = 'systeme'/'agent', ou si l'utilisateur a depuis été supprimé
  details: unknown;
  horodatage: string;
}

// LIMITE_DEFAUT volontairement basse : ce endpoint alimente une vue humaine
// (module 6/10), pas un export complet — voir listerAuditLogExport pour le
// CSV sans limite, qui sert justement de contournement pour l'export complet.
const LIMITE_DEFAUT_AUDIT = 200;
const LIMITE_MAX_AUDIT = 1000;

export async function listerAuditLog(
  client: PoolClient,
  dossierId: string,
  filtres: { typeEvenement?: string; acteur?: string; depuis?: string; jusqua?: string; limite?: number } = {}
): Promise<AuditEvenementDb[]> {
  const conditions = ['a.dossier_id = $1'];
  const params: unknown[] = [dossierId];

  if (filtres.typeEvenement) {
    params.push(filtres.typeEvenement);
    conditions.push(`a.type_evenement = $${params.length}`);
  }
  if (filtres.acteur) {
    params.push(filtres.acteur);
    conditions.push(`a.acteur = $${params.length}`);
  }
  if (filtres.depuis) {
    params.push(filtres.depuis);
    conditions.push(`a.horodatage >= $${params.length}`);
  }
  if (filtres.jusqua) {
    params.push(filtres.jusqua);
    conditions.push(`a.horodatage <= $${params.length}`);
  }

  const limite = Math.min(filtres.limite ?? LIMITE_DEFAUT_AUDIT, LIMITE_MAX_AUDIT);
  params.push(limite);

  const res = await client.query(
    `SELECT a.id, a.dossier_id, a.type_evenement, a.module_source, a.acteur,
            a.acteur_utilisateur_id, u.nom AS acteur_nom, a.details, a.horodatage
     FROM audit_log a
     LEFT JOIN utilisateurs u ON u.id = a.acteur_utilisateur_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.horodatage DESC
     LIMIT $${params.length}`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    dossierId: r.dossier_id,
    typeEvenement: r.type_evenement,
    moduleSource: r.module_source,
    acteur: r.acteur,
    acteurUtilisateurId: r.acteur_utilisateur_id,
    acteurNom: r.acteur_nom,
    details: r.details,
    horodatage: r.horodatage,
  }));
}

// Export complet : plafond de sécurité large (pas 200) car destiné à
// produire un fichier téléchargé pour preuve DGFIP, pas un affichage écran.
// Le plafond existe quand même pour éviter qu'un dossier avec des années
// d'historique ne fasse exploser la mémoire du process API en un seul appel.
const LIMITE_EXPORT_AUDIT = 20_000;

export async function listerAuditLogPourExport(
  client: PoolClient,
  dossierId: string,
  filtres: { typeEvenement?: string; acteur?: string; depuis?: string; jusqua?: string } = {}
): Promise<AuditEvenementDb[]> {
  return listerAuditLog(client, dossierId, { ...filtres, limite: LIMITE_EXPORT_AUDIT });
}

// ============================================================================
// PARAMÉTRAGE (cabinet et dossier)
// ============================================================================

export interface ParametreDb {
  cle: string;
  valeur: unknown;
  updatedAt: string;
}

// Clés dont la valeur ne doit jamais transiter en clair vers le frontend une
// fois définie (secrets). listerParametresCabinet la masque systématiquement
// — parametreCabinetValeur, elle, la retourne en clair : usage strictement
// serveur (ex: résoudre la clé pour un appel LLM), jamais exposée par une
// route qui renvoie son résultat tel quel au client.
const CLES_SECRETES = new Set(['mistral_api_key']);

export async function listerParametresCabinet(client: PoolClient, cabinetId: string): Promise<ParametreDb[]> {
  const res = await client.query(`SELECT cle, valeur, updated_at FROM parametres_cabinet WHERE cabinet_id = $1`, [
    cabinetId,
  ]);
  return res.rows.map((r) => ({
    cle: r.cle,
    valeur: CLES_SECRETES.has(r.cle) ? (r.valeur ? '••••••••' : null) : r.valeur,
    updatedAt: r.updated_at,
  }));
}

export async function parametreCabinetValeur(client: PoolClient, cabinetId: string, cle: string): Promise<unknown> {
  const res = await client.query(`SELECT valeur FROM parametres_cabinet WHERE cabinet_id = $1 AND cle = $2`, [
    cabinetId,
    cle,
  ]);
  return res.rows[0]?.valeur ?? null;
}

// Symétrique de parametreCabinetValeur — premier vrai consommateur d'un
// paramètre dossier (09/08) : le régime TVA sur encaissement, qui influence
// directement le calcul (cf. chantier B, pipeline.ts).
export async function parametreDossierValeur(client: PoolClient, dossierId: string, cle: string): Promise<unknown> {
  const res = await client.query(`SELECT valeur FROM parametres_dossier WHERE dossier_id = $1 AND cle = $2`, [
    dossierId,
    cle,
  ]);
  return res.rows[0]?.valeur ?? null;
}

export async function listerParametresDossier(client: PoolClient, dossierId: string): Promise<ParametreDb[]> {
  const res = await client.query(`SELECT cle, valeur, updated_at FROM parametres_dossier WHERE dossier_id = $1`, [
    dossierId,
  ]);
  return res.rows.map((r) => ({ cle: r.cle, valeur: r.valeur, updatedAt: r.updated_at }));
}

// ============================================================================
// "À TRAITER" — agrégat de tout ce qui attend une décision humaine
// ============================================================================
// Point d'entrée demandé par Rami : avant de lancer quoi que ce soit sur un
// dossier, voir d'un coup tout ce qui bloque ou attend un choix — anomalies
// bloquantes non traitées, propositions de conventions/taux en attente de
// confirmation, calculs en brouillon. Recompose des fonctions de lecture
// déjà existantes plutôt que d'inventer une nouvelle requête SQL geante —
// chacune reste la source de vérité pour son propre écran, celle-ci n'est
// qu'une vue agrégée en lecture.

export interface ElementATraiter {
  type: 'anomalie_bloquante' | 'convention_candidate' | 'taux_candidate' | 'taux_tiers_candidate' | 'calcul_brouillon';
  id: string;
  resume: string;
}

export async function listerElementsATraiter(client: PoolClient, dossierId: string): Promise<ElementATraiter[]> {
  const [anomalies, conventions, taux, tauxTiers, calculs] = await Promise.all([
    listerAnomalies(client, dossierId, { statut: 'ouvert' }),
    listerConventions(client, dossierId, 'candidate'),
    listerTauxHistorique(client, dossierId, 'candidate'),
    listerTauxHistoriqueTiers(client, dossierId, 'candidate'),
    listerCalculs(client, dossierId),
  ]);

  const elements: ElementATraiter[] = [];

  for (const a of anomalies.filter((a) => a.gravite === 'bloquant')) {
    elements.push({ type: 'anomalie_bloquante', id: a.id, resume: a.description });
  }
  for (const c of conventions) {
    elements.push({ type: 'convention_candidate', id: c.id, resume: `Convention "${c.cle}" à confirmer` });
  }
  for (const t of taux) {
    elements.push({
      type: 'taux_candidate',
      id: t.id,
      resume: `Taux ${t.tauxHabituel}% proposé pour le compte ${t.compteProduitOuCharge}`,
    });
  }
  for (const t of tauxTiers) {
    elements.push({
      type: 'taux_tiers_candidate',
      id: t.id,
      resume: `Taux ${t.tauxHabituel}% proposé pour le client ${t.numeroCompteTiers}`,
    });
  }
  for (const c of calculs.filter((c) => c.statut === 'brouillon')) {
    elements.push({
      type: 'calcul_brouillon',
      id: c.id,
      resume: `Calcul ${c.periodeDebut} — ${c.periodeFin} en attente de validation ou rejet`,
    });
  }

  return elements;
}

export interface TauxAssigneDb {
  compte: string;
  tauxAssigne: string;
  updatedAt: string;
}

export async function listerTauxAssignes(client: PoolClient, dossierId: string): Promise<TauxAssigneDb[]> {
  const res = await client.query(
    `SELECT compte_produit_ou_charge, taux_assigne, updated_at FROM taux_assigne_compte WHERE dossier_id = $1 ORDER BY compte_produit_ou_charge ASC`,
    [dossierId]
  );
  return res.rows.map((r) => ({
    compte: r.compte_produit_ou_charge,
    tauxAssigne: r.taux_assigne,
    updatedAt: r.updated_at,
  }));
}

// Toute anomalie (type + pièce) déjà résolue ou justifiée pour ce dossier —
// filtre générique appliqué à TOUTES les anomalies avant persistance
// (pipeline.ts), pas seulement au 471. Bug réel trouvé le 09/08 : seuls
// encaissement_non_affecte (via listerLedgerEntryIdsQualifies) et
// nouveau_tiers_a_verifier (via tiers_reference) étaient protégés contre la
// réapparition d'une anomalie déjà traitée à la relance d'un cycle — les 8
// autres types (avoir_a_verifier, paiement_partiel_a_verifier,
// encaissement_client_taux_applique, etc.) revenaient systématiquement,
// même après Résoudre/Justifier. La clé "type:pièce" reste stable d'un
// cycle à l'autre pour une même écriture Pennylane, donc fiable pour ce
// rapprochement.
export async function listerAnomaliesTraiteesParTypeEtPiece(
  client: PoolClient,
  dossierId: string
): Promise<Set<string>> {
  const res = await client.query<{ type_anomalie: string; reference_piece: string | null }>(
    `SELECT type_anomalie, reference_piece FROM anomalies
     WHERE dossier_id = $1 AND statut IN ('resolu', 'justifie') AND reference_piece IS NOT NULL`,
    [dossierId]
  );
  return new Set(res.rows.map((r) => `${r.type_anomalie}:${r.reference_piece}`));
}

export interface VehiculeDb {
  id: string;
  designation: string | null;
  typeBien: 'vehicule_tourisme' | 'vehicule_utilitaire' | 'autre';
  montantHt: number | null;
  dateAcquisition: string | null;
  statut: 'candidate' | 'confirmed' | 'rejected';
}

export async function listerVehicules(client: PoolClient, dossierId: string): Promise<VehiculeDb[]> {
  const res = await client.query(
    `SELECT id, designation, type_bien, montant_ht, date_acquisition, statut
     FROM immobilisations
     WHERE dossier_id = $1 AND type_bien IS NOT NULL AND statut != 'rejected'
     ORDER BY created_at DESC`,
    [dossierId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    designation: r.designation,
    typeBien: r.type_bien,
    montantHt: r.montant_ht !== null ? Number.parseFloat(r.montant_ht) : null,
    dateAcquisition: r.date_acquisition,
    statut: r.statut,
  }));
}

export interface AjustementCalculDb {
  typeMontant: 'collectee_totale' | 'deductible_totale';
  montantOriginal: number;
  montantAjuste: number;
  justification: string;
  createdAt: Date;
}

export async function listerAjustementsCalcul(client: PoolClient, calculId: string): Promise<AjustementCalculDb[]> {
  const res = await client.query(
    `SELECT type_montant, montant_original, montant_ajuste, justification, created_at
     FROM ajustements_calcul WHERE calcul_id = $1`,
    [calculId]
  );
  return res.rows.map((r) => ({
    typeMontant: r.type_montant,
    montantOriginal: Number.parseFloat(r.montant_original),
    montantAjuste: Number.parseFloat(r.montant_ajuste),
    justification: r.justification,
    createdAt: r.created_at,
  }));
}
