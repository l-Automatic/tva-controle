import type { Anomalie, AuditEvenement, Calcul, Proposition, ResultatCycle } from './types';

const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  cabinetId: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'x-cabinet-id': cabinetId,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { erreur?: string };
      if (body.erreur) message = body.erreur;
    } catch {
      // corps non-JSON, on garde le statusText
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function fetchAnomalies(
  cabinetId: string,
  dossierId: string,
  statut?: string
): Promise<Anomalie[]> {
  const query = statut ? `?statut=${encodeURIComponent(statut)}` : '';
  return request<Anomalie[]>(`/dossiers/${dossierId}/anomalies${query}`, cabinetId);
}

export function resoudreAnomalie(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  commentaire?: string
): Promise<void> {
  return request<void>(`/anomalies/${id}/resoudre`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, ...(commentaire ? { commentaire } : {}) }),
  });
}

export function justifierAnomalie(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  commentaire: string
): Promise<void> {
  return request<void>(`/anomalies/${id}/justifier`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, commentaire }),
  });
}

export function fetchConventions(
  cabinetId: string,
  dossierId: string,
  statut?: string
): Promise<Proposition[]> {
  const query = statut ? `?statut=${encodeURIComponent(statut)}` : '';
  return request<Proposition[]>(`/dossiers/${dossierId}/conventions${query}`, cabinetId);
}

export function ajouterConvention(
  cabinetId: string,
  dossierId: string,
  utilisateurId: string,
  cle: string,
  valeur: unknown
): Promise<{ id: string }> {
  return request<{ id: string }>(`/dossiers/${dossierId}/conventions`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, cle, valeur }),
  });
}

export function confirmerConvention(
  cabinetId: string,
  id: string,
  utilisateurId: string
): Promise<void> {
  return request<void>(`/conventions/${id}/confirmer`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

export function rejeterConvention(cabinetId: string, id: string, utilisateurId: string): Promise<void> {
  return request<void>(`/conventions/${id}/rejeter`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

export function fetchAudit(
  cabinetId: string,
  dossierId: string,
  filtres: { typeEvenement?: string; acteur?: string } = {}
): Promise<AuditEvenement[]> {
  const params = new URLSearchParams();
  if (filtres.typeEvenement) params.set('typeEvenement', filtres.typeEvenement);
  if (filtres.acteur) params.set('acteur', filtres.acteur);
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<AuditEvenement[]>(`/dossiers/${dossierId}/audit${query}`, cabinetId);
}

// Un lien <a href> classique ne peut pas envoyer le header x-cabinet-id
// (nécessaire pour le contexte RLS côté serveur) — on récupère donc le CSV
// via fetch, puis on déclenche le téléchargement navigateur nous-mêmes via
// une URL objet temporaire.
export async function telechargerExportAudit(
  cabinetId: string,
  dossierId: string,
  filtres: { typeEvenement?: string; acteur?: string } = {}
): Promise<void> {
  const params = new URLSearchParams();
  if (filtres.typeEvenement) params.set('typeEvenement', filtres.typeEvenement);
  if (filtres.acteur) params.set('acteur', filtres.acteur);
  const query = params.toString() ? `?${params.toString()}` : '';

  const response = await fetch(`${BASE_URL}/dossiers/${dossierId}/audit/export${query}`, {
    headers: { 'x-cabinet-id': cabinetId },
  });
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `audit-${dossierId}.csv`;
  lien.click();
  URL.revokeObjectURL(url);
}

export function fetchTauxHistorique(
  cabinetId: string,
  dossierId: string,
  statut?: string
): Promise<Proposition[]> {
  const query = statut ? `?statut=${encodeURIComponent(statut)}` : '';
  return request<Proposition[]>(`/dossiers/${dossierId}/taux-historique${query}`, cabinetId);
}

export function confirmerTauxHistorique(
  cabinetId: string,
  id: string,
  utilisateurId: string
): Promise<void> {
  return request<void>(`/taux-historique/${id}/confirmer`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

export function rejeterTauxHistorique(cabinetId: string, id: string, utilisateurId: string): Promise<void> {
  return request<void>(`/taux-historique/${id}/rejeter`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

export interface ParametresCycle {
  periodeDebut: string;
  periodeFin: string;
  pennylaneToken: string;
  comptesVenteService?: string[];
  comptesChargeService?: string[];
  comptesEquipement?: string[];
  comptesCarburant?: string[];
}

// 409 (ApiError.status) si un calcul déjà validé/déclaré existe sur cette
// période — géré par l'appelant, pas ici (message déjà porté par ApiError).
export function lancerCycle(
  cabinetId: string,
  dossierId: string,
  parametres: ParametresCycle
): Promise<ResultatCycle> {
  return request<ResultatCycle>(`/dossiers/${dossierId}/cycles`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(parametres),
  });
}

export function fetchCalculs(cabinetId: string, dossierId: string): Promise<Calcul[]> {
  return request<Calcul[]>(`/dossiers/${dossierId}/calculs`, cabinetId);
}

// 409 (ApiError.status) si le calcul n'est plus en brouillon (déjà
// validé/rejeté entre-temps par quelqu'un d'autre) — géré par l'appelant.
export function validerCalcul(cabinetId: string, id: string, utilisateurId: string): Promise<void> {
  return request<void>(`/calculs/${id}/valider`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

export function rejeterCalcul(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  motif: string
): Promise<void> {
  return request<void>(`/calculs/${id}/rejeter`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, motif }),
  });
}
