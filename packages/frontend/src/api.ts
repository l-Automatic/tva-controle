import type {
  Anomalie,
  AuditEvenement,
  Calcul,
  Dossier,
  ElementATraiter,
  MotifNumerotation,
  NiveauConfianceTiers,
  Parametre,
  Proposition,
  QualificationEncaissement,
  ResultatCycle,
  TauxAssigne,
  TauxAssigneEntry,
  TiersReference,
  TypeBienVehicule,
  Vehicule,
} from './types';

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
  filtres: { statut?: string; periode?: string } = {}
): Promise<Anomalie[]> {
  const params = new URLSearchParams();
  if (filtres.statut) params.set('statut', filtres.statut);
  if (filtres.periode) params.set('periode', filtres.periode);
  const query = params.toString() ? `?${params.toString()}` : '';
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

// Restreint aux anomalies encore 'ouvert' côté serveur (les autres ids sont
// silencieusement ignorés) — un seul commentaire partagé pour tout le lot.
export function resoudreAnomaliesEnMasse(
  cabinetId: string,
  anomalieIds: string[],
  utilisateurId: string,
  commentaire: string
): Promise<{ dossierId: string | null; nombreResolues: number }> {
  return request<{ dossierId: string | null; nombreResolues: number }>('/anomalies/resoudre-en-masse', cabinetId, {
    method: 'POST',
    body: JSON.stringify({ anomalieIds, utilisateurId, commentaire }),
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

// 409 (ApiError.status) si l'anomalie n'est plus qualifiable (déjà traitée
// entre le chargement de la liste et le clic) — géré par l'appelant.
export function qualifierEncaissement(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  qualification: QualificationEncaissement
): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, ...qualification }),
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

// Retire un compte précis d'une convention de type liste déjà confirmée
// (ex : comptes_charge_service) sans toucher au reste de la liste.
export function retirerCompteConvention(
  cabinetId: string,
  dossierId: string,
  cle: string,
  compte: string,
  utilisateurId: string
): Promise<void> {
  return request<void>('/conventions/retirer-compte', cabinetId, {
    method: 'POST',
    body: JSON.stringify({ dossierId, cle, compte, utilisateurId }),
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

// --- Taux historique tiers (chantier B — compte client 411xxx) ---

export function fetchTauxHistoriqueTiers(
  cabinetId: string,
  dossierId: string,
  statut?: string
): Promise<Proposition[]> {
  const query = statut ? `?statut=${encodeURIComponent(statut)}` : '';
  return request<Proposition[]>(`/dossiers/${dossierId}/taux-historique-tiers${query}`, cabinetId);
}

export function confirmerTauxHistoriqueTiers(
  cabinetId: string,
  id: string,
  utilisateurId: string
): Promise<void> {
  return request<void>(`/taux-historique-tiers/${id}/confirmer`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

export function rejeterTauxHistoriqueTiers(cabinetId: string, id: string, utilisateurId: string): Promise<void> {
  return request<void>(`/taux-historique-tiers/${id}/rejeter`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

// Assignation directe d'un taux habituel pour un compte client, sans
// attendre la détection automatique sur historique lettré (qui reste
// candidate/confirmed dans l'onglet Taux historique) — confirme
// immédiatement, remplace toute confirmation précédente pour ce compte.
export function assignerTauxHistoriqueTiersManuel(
  cabinetId: string,
  dossierId: string,
  numeroCompteTiers: string,
  tauxHabituel: number | 'mixte',
  utilisateurId: string
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/taux-historique-tiers/assigner`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ numeroCompteTiers, tauxHabituel, utilisateurId }),
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

// Déclenchement manuel uniquement (bouton dédié) — jamais appelé
// automatiquement à chaque cycle. Le motif proposé, s'il existe, est déjà
// enregistré côté backend comme convention candidate au retour de cet
// appel (rien à faire ici pour le persister).
export function analyserMotifNumerotation(
  cabinetId: string,
  dossierId: string,
  parametres: { pennylaneToken: string; periodeDebut: string; periodeFin: string; utilisateurId: string }
): Promise<{ motifPropose: MotifNumerotation | null }> {
  return request<{ motifPropose: MotifNumerotation | null }>(`/dossiers/${dossierId}/motif-numerotation/analyser`, cabinetId, {
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

// --- Paramétrage ---
// Les valeurs secrètes (ex : mistral_api_key) sont déjà masquées par l'API
// avant de sortir de la couche DB (renvoyées comme '••••••••') — jamais de
// valeur en clair à masquer ici, ni de tentative de déchiffrement.

export function fetchParametresCabinet(cabinetId: string): Promise<Parametre[]> {
  return request<Parametre[]>('/parametres-cabinet', cabinetId);
}

export function definirParametreCabinet(
  cabinetId: string,
  utilisateurId: string,
  cle: string,
  valeur: unknown
): Promise<void> {
  return request<void>('/parametres-cabinet', cabinetId, {
    method: 'PUT',
    body: JSON.stringify({ utilisateurId, cle, valeur }),
  });
}

// --- Dossiers (sélection) ---

export function fetchDossiers(cabinetId: string, q?: string): Promise<Dossier[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  return request<Dossier[]>(`/dossiers${query}`, cabinetId);
}

// --- Point d'entrée "à traiter" ---

export function fetchElementsATraiter(cabinetId: string, dossierId: string): Promise<ElementATraiter[]> {
  return request<ElementATraiter[]>(`/dossiers/${dossierId}/a-traiter`, cabinetId);
}

// --- Tiers de référence (mémoire de confiance) ---

export function fetchTiersReference(cabinetId: string, dossierId: string): Promise<TiersReference[]> {
  return request<TiersReference[]>(`/dossiers/${dossierId}/tiers`, cabinetId);
}

// Correction manuelle du niveau de confiance — la progression automatique
// (via les cycles) reste la voie normale, ceci est l'exception.
export function corrigerNiveauConfianceTiers(
  cabinetId: string,
  dossierId: string,
  numeroCompteTiers: string,
  niveauConfiance: NiveauConfianceTiers,
  utilisateurId: string
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/tiers/corriger`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ numeroCompteTiers, niveauConfiance, utilisateurId }),
  });
}

// --- Taux assigné par compte (produit/charge) — assignation directe, pas
// de workflow candidate/confirmed. ---

export function fetchTauxAssignes(cabinetId: string, dossierId: string): Promise<TauxAssigneEntry[]> {
  return request<TauxAssigneEntry[]>(`/dossiers/${dossierId}/taux-assignes`, cabinetId);
}

export function assignerTauxCompte(
  cabinetId: string,
  dossierId: string,
  compte: string,
  taux: TauxAssigne,
  utilisateurId: string
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/taux-assignes`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ compte, taux, utilisateurId }),
  });
}

// --- Parc de véhicules ---

export function fetchVehicules(cabinetId: string, dossierId: string): Promise<Vehicule[]> {
  return request<Vehicule[]>(`/dossiers/${dossierId}/vehicules`, cabinetId);
}

export function ajouterVehicule(
  cabinetId: string,
  dossierId: string,
  vehicule: { designation?: string; typeBien: TypeBienVehicule; montantHt?: number; dateAcquisition?: string },
  utilisateurId: string
): Promise<{ id: string }> {
  return request<{ id: string }>(`/dossiers/${dossierId}/vehicules`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ ...vehicule, utilisateurId }),
  });
}

export function retirerVehicule(cabinetId: string, id: string, utilisateurId: string): Promise<void> {
  return request<void>(`/vehicules/${id}/retirer`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
  });
}

export function fetchParametresDossier(cabinetId: string, dossierId: string): Promise<Parametre[]> {
  return request<Parametre[]>(`/dossiers/${dossierId}/parametres`, cabinetId);
}

export function definirParametreDossier(
  cabinetId: string,
  dossierId: string,
  utilisateurId: string,
  cle: string,
  valeur: unknown
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/parametres`, cabinetId, {
    method: 'PUT',
    body: JSON.stringify({ utilisateurId, cle, valeur }),
  });
}
