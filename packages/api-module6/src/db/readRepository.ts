import type { PoolClient } from 'pg';

export interface AnomalieDb {
  id: string;
  dossierId: string;
  periode: string;
  typeAnomalie: string;
  gravite: 'bloquant' | 'signale' | 'info';
  referencePiece: string | null;
  description: string;
  details: unknown;
  statut: 'ouvert' | 'resolu' | 'justifie';
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
  }
  if (filtres.periode) {
    params.push(filtres.periode);
    conditions.push(`periode = $${params.length}`);
  }

  const res = await client.query(
    `SELECT id, dossier_id, periode, type_anomalie, gravite, reference_piece, description, details, statut, created_at
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
    description: r.description,
    details: r.details,
    statut: r.statut,
    createdAt: r.created_at,
  }));
}

export interface PropositionDb {
  id: string;
  dossierId: string;
  cle?: string | undefined; // conventions_dossier uniquement
  compteProduitOuCharge?: string | undefined; // taux_historique uniquement
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

export interface CalculDb {
  id: string;
  periodeDebut: string;
  periodeFin: string;
  statut: 'brouillon' | 'valide' | 'declare';
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
