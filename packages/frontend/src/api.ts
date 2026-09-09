import type {
  AjustementCalcul,
  Anomalie,
  AuditEvenement,
  Calcul,
  CompteACategoriser,
  CompteTvaAConfirmer,
  ConfigurationOnboarding,
  DeclarationCalcul,
  DetailCalculLigne,
  Dossier,
  DossierComplet,
  ElementATraiter,
  EtatPortesObligatoires,
  FactureARapprocher,
  InfosIdentiteDossier,
  MotifNumerotation,
  NiveauConfianceTiers,
  Parametre,
  ParametresRapprochementPaiementAchat,
  Proposition,
  QualificationEncaissement,
  ResultatComptesACategoriser,
  ResultatCycle,
  ResultatSynchronisationDossiers,
  Role,
  Session,
  TauxAssigne,
  TauxAssigneEntry,
  TiersReference,
  TypeBienVehicule,
  TypeCarburant,
  TypeMontantAjustement,
  UtilisateurCabinet,
  Vehicule,
} from './types';

const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // Corps JSON brut de la réponse d'erreur, quand il a pu être parsé
    // (brief v34) — permet à un appelant (ex: le 409 de POST
    // /dossiers/:id/cycles) de lire comptesACategoriser/facturesARapprocher
    // directement depuis l'erreur, sans second appel réseau immédiat.
    public readonly corps?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Authentification (brief v25) — remplace l'ancien en-tête x-cabinet-id
// (disparu côté backend) par Authorization: Bearer <jeton>, le cabinet
// vient désormais du jeton côté serveur. Module-level plutôt que passé en
// paramètre partout : évite de faire remonter le jeton jusqu'à chacun des
// ~60 appels existants pour un mécanisme purement transverse.
//
// Initialisé directement depuis localStorage (pas juste par App.tsx via
// definirJeton) — bug réel trouvé en vérifiant v29 : App.tsx ne pose le
// jeton que dans un useEffect, qui s'exécute APRÈS les effects des
// composants enfants déjà montés (dossier + zone restaurés depuis
// localStorage dès le premier rendu après un rechargement). N'importe quel
// panneau qui fetch au montage partait donc avec jetonActuel=null,
// provoquant un vrai crash de toute l'app (401 non rattrapé) à chaque
// rechargement de page avec un dossier déjà sélectionné.
let jetonActuel: string | null = (() => {
  try {
    const brut = localStorage.getItem('module6.session');
    return brut ? ((JSON.parse(brut) as { jeton?: string }).jeton ?? null) : null;
  } catch {
    return null;
  }
})();
let gestionnaireNonAutorise: (() => void) | null = null;

export function definirJeton(jeton: string | null): void {
  jetonActuel = jeton;
}

// Appelé une fois par App.tsx pour être notifié d'un 401 sur N'IMPORTE
// quel appel (jeton absent, invalide ou expiré) — efface la session et
// revient à l'écran de connexion, peu importe quel composant a déclenché
// l'appel qui a échoué.
export function surSessionExpiree(gestionnaire: (() => void) | null): void {
  gestionnaireNonAutorise = gestionnaire;
}

// cabinetId conservé en paramètre sur toutes les fonctions ci-dessous pour
// ne pas devoir toucher chacun de leurs appelants existants — mais il n'est
// plus utilisé ici : le cabinet vient exclusivement du jeton côté serveur
// depuis le retrait de x-cabinet-id (brief v25).
async function request<T>(
  path: string,
  cabinetId: string,
  init: RequestInit = {}
): Promise<T> {
  void cabinetId;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(jetonActuel ? { Authorization: `Bearer ${jetonActuel}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    gestionnaireNonAutorise?.();
  }

  if (!response.ok) {
    let message = response.statusText;
    let corps: unknown;
    try {
      corps = await response.json();
      const body = corps as { erreur?: string };
      if (body.erreur) message = body.erreur;
    } catch {
      // corps non-JSON, on garde le statusText
    }
    throw new ApiError(message, response.status, corps);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// Route publique (pas de jeton à envoyer, cf. ROUTES_PUBLIQUES côté
// backend) — 401 volontairement générique ("Identifiants invalides."),
// jamais de distinction email inconnu / mot de passe incorrect.
export async function login(email: string, motDePasse: string): Promise<Session> {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, motDePasse }),
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
  return (await response.json()) as Session;
}

// --- Gestion des utilisateurs (admin_cabinet uniquement, 403 sinon) ---

export function fetchUtilisateurs(cabinetId: string): Promise<UtilisateurCabinet[]> {
  return request<UtilisateurCabinet[]>('/utilisateurs', cabinetId);
}

export function creerUtilisateur(
  cabinetId: string,
  params: { nom: string; email: string; role: Role; motDePasse: string }
): Promise<{ id: string }> {
  return request<{ id: string }>('/utilisateurs', cabinetId, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function redefinirMotDePasse(cabinetId: string, utilisateurId: string, motDePasse: string): Promise<void> {
  return request<void>(`/utilisateurs/${utilisateurId}/mot-de-passe`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ motDePasse }),
  });
}

// Désactive plutôt que supprime — 409 si c'est le dernier admin_cabinet
// actif du cabinet (brief v26), message backend déjà clair, affiché tel quel.
export function desactiverUtilisateur(cabinetId: string, utilisateurId: string): Promise<void> {
  return request<void>(`/utilisateurs/${utilisateurId}/desactiver`, cabinetId, { method: 'POST' });
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

// Recalcule uniquement compte_tva_non_reconnu sur la période donnée — pas
// de cycle complet (pas de lettrage, pas d'IA, pas les 19 autres
// contrôles), cf. brief v30. Si la convention a entre-temps été confirmée,
// l'anomalie est marquée obsolète côté backend et disparaît au prochain
// chargement de la liste.
export function verifierComptesNonReconnus(
  cabinetId: string,
  dossierId: string,
  params: { periodeDebut: string; periodeFin: string }
): Promise<{ anomalies: number }> {
  return request<{ anomalies: number }>(`/dossiers/${dossierId}/verifier-comptes-non-reconnus`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Qualification structurée pour avoir_a_verifier (brief v37) — remplace
// Résoudre/Justifier pour ce type précisément : avoir ou OD de
// régularisation, jamais un commentaire libre. N'affecte jamais le
// calcul, juste une trace de décision — la correction éventuelle passe
// par verifierAvoirs ci-dessous, pas par cette qualification.
export function qualifierAvoir(cabinetId: string, id: string, utilisateurId: string, type: 'avoir' | 'od'): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier-avoir`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, type }),
  });
}

// "Vérifier à nouveau" pour avoir_a_verifier (brief v37) — distinct de la
// qualification ci-dessus : ici, "je pense l'avoir corrigé dans
// Pennylane, vérifie et corrige le calcul si besoin". Contrairement à
// verifierComptesNonReconnus, AJUSTE le calcul brouillon existant si le
// débit/crédit litigieux a bien été corrigé côté Pennylane (corrections
// > 0) — l'anomalie disparaît alors au prochain chargement.
export function verifierAvoirs(
  cabinetId: string,
  dossierId: string,
  params: { periodeDebut: string; periodeFin: string; utilisateurId: string }
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
  return request<{ anomaliesOuvertes: number; corrections: number }>(`/dossiers/${dossierId}/verifier-avoirs`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Qualification structurée pour immobilisation_vehicule_tourisme_a_verifier
// (brief v40) — même principe que qualifierAvoir : ne touche jamais le
// calcul directement, juste une trace de décision. 'confirme_tourisme'
// signale qu'une correction externe (Pennylane) est attendue, à repérer
// ensuite via verifierVehiculeTourisme ; 'pas_tourisme' signifie que le
// jugement IA était faux, l'anomalie est classée sans suite.
export function qualifierVehiculeTourisme(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  type: 'confirme_tourisme' | 'pas_tourisme'
): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier-vehicule-tourisme`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, type }),
  });
}

// "Vérifier à nouveau" pour immobilisation_vehicule_tourisme_a_verifier
// (brief v40) — même principe que verifierAvoirs : ajuste le calcul
// brouillon existant (côté déductible) si la TVA n'est plus déduite sur
// la ligne litigieuse.
export function verifierVehiculeTourisme(
  cabinetId: string,
  dossierId: string,
  params: { periodeDebut: string; periodeFin: string; utilisateurId: string }
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
  return request<{ anomaliesOuvertes: number; corrections: number }>(
    `/dossiers/${dossierId}/verifier-vehicule-tourisme`,
    cabinetId,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

// Qualification structurée pour immobilisation_potentielle_non_passee
// (brief v41) — même principe que qualifierAvoir/qualifierVehiculeTourisme :
// ne touche jamais le calcul directement. 'confirme_immo' signale qu'une
// reclassification externe (Pennylane) est attendue, à repérer ensuite via
// verifierImmobilisation ; 'ignore' signifie que l'achat reste
// correctement en charge, rien à faire.
export function qualifierImmobilisation(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  type: 'confirme_immo' | 'ignore'
): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier-immobilisation`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, type }),
  });
}

// "Vérifier à nouveau" pour immobilisation_potentielle_non_passee (brief
// v41) — particularité par rapport à verifierAvoirs/verifierVehiculeTourisme :
// une correction ne change jamais le total de TVA déductible, elle
// TRANSFÈRE un montant entre deductible_abs et deductible_immo (les deux
// lignes bougent en sens inverse dans le panneau de calcul).
export function verifierImmobilisation(
  cabinetId: string,
  dossierId: string,
  params: { periodeDebut: string; periodeFin: string; utilisateurId: string }
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
  return request<{ anomaliesOuvertes: number; corrections: number }>(
    `/dossiers/${dossierId}/verifier-immobilisation`,
    cabinetId,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

// Qualification structurée pour nouveau_tiers_a_verifier (brief v42) — ne
// touche jamais le calcul (anomalie purement informative), mais contrairement
// aux qualifications précédentes les deux options ont un effet dans le temps
// différent : 'valide' mémorise ce tiers définitivement (ne sera plus jamais
// signalé, sur aucun cycle futur) ; 'ignore' ne résout que cette occurrence,
// le même tiers réapparaîtra au prochain cycle qui le touche.
export function qualifierNouveauTiers(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  type: 'valide' | 'ignore'
): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier-nouveau-tiers`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, type }),
  });
}

// Qualification structurée pour encaissement_client_taux_applique (brief
// v43) — 'bon_taux' résout sans toucher au calcul (le taux automatique
// était déjà correct) ; 'mauvais_taux' transfère un montant entre les deux
// catégories de taux concernées dans le calcul brouillon, à partir du
// nouveau taux saisi. Correction ponctuelle sur cette ligne précise
// uniquement — ne change jamais le taux historique retenu pour ce client
// (écran séparé), l'anomalie se représentera sur un futur encaissement non
// lettré du même client.
export function qualifierEncaissementClientTaux(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  params: { type: 'bon_taux' } | { type: 'mauvais_taux'; nouveauTaux: number }
): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier-encaissement-client-taux`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, ...params }),
  });
}

// Qualification structurée pour tva_hotel_a_verifier (brief v44) — jugement
// IA, signalé. Jamais utilisée pour tva_hotel_a_tort (déterministe,
// bloquant, aucune ambiguïté possible : un seul bouton "Vérifier à
// nouveau", pas de qualification préalable).
export function qualifierTvaHotel(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  type: 'confirme' | 'ignore'
): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier-tva-hotel`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, type }),
  });
}

// "Vérifier à nouveau" pour les DEUX types tva_hotel_a_tort et
// tva_hotel_a_verifier (brief v44) — même route, gère les deux en un seul
// appel côté backend.
export function verifierTvaHotel(
  cabinetId: string,
  dossierId: string,
  params: { periodeDebut: string; periodeFin: string; utilisateurId: string }
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
  return request<{ anomaliesOuvertes: number; corrections: number }>(`/dossiers/${dossierId}/verifier-tva-hotel`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// "Vérifier à nouveau" pour trou_numerotation_facture ET doublon_numerotation_facture
// (brief v45) — même route pour les deux types (consolidés, au plus une
// anomalie de chaque par cycle). Pas de qualification/mémoire nécessaire
// ici : "Ignorer" est déjà couvert par le Résoudre générique, chaque cycle
// redétecte tout depuis zéro. Rejoue la détection sur des données
// fraîches — pas de utilisateurId, contrairement aux autres routes de
// vérification (rien n'est jamais qualifié manuellement ici).
export function verifierNumerotation(
  cabinetId: string,
  dossierId: string,
  params: { periodeDebut: string; periodeFin: string }
): Promise<{ trouOuvert: boolean; doublonOuvert: boolean }> {
  return request<{ trouOuvert: boolean; doublonOuvert: boolean }>(`/dossiers/${dossierId}/verifier-numerotation`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Quatre routes "Vérifier à nouveau" (brief v46), toutes le même principe :
// erreurs de saisie certaines ou déductions statistiques, jamais une
// question à trancher — un seul bouton, pas de qualification préalable,
// aucun ajustement du calcul. Réponse {anomaliesOuvertes} seulement (pas de
// champ "corrections", contrairement aux mécanismes de transfert
// précédents). verifierAutoliquidation couvre à elle seule
// autoliquidation_desequilibree ET autoliquidation_incomplete.
function verifierSansQualification(
  route: string
): (cabinetId: string, dossierId: string, params: { periodeDebut: string; periodeFin: string }) => Promise<{ anomaliesOuvertes: number }> {
  return (cabinetId, dossierId, params) =>
    request<{ anomaliesOuvertes: number }>(`/dossiers/${dossierId}/${route}`, cabinetId, {
      method: 'POST',
      body: JSON.stringify(params),
    });
}

export const verifierAutoliquidation = verifierSansQualification('verifier-autoliquidation');
export const verifierImmobilisationTva = verifierSansQualification('verifier-immobilisation-tva');
export const verifierTauxProduit = verifierSansQualification('verifier-taux-produit');
export const verifierCoherenceTauxAutoliquidation = verifierSansQualification('verifier-coherence-taux-autoliquidation');
// cadeau_client_seuil_depasse (brief v47) — transaction individuelle
// dépassant le seuil légal de 73€ TTC avec TVA réellement déduite, jamais
// un cumul annuel. Même famille exactement que les 4 routes ci-dessus.
export const verifierCadeauClient = verifierSansQualification('verifier-cadeau-client');

// Qualification structurée pour entretien_vehicule_tourisme_deduit_a_tort
// ET location_vehicule_tourisme_deduite_a_tort (brief v48) — même principe
// exactement que tva_hotel_a_verifier (brief v44), mais une seule route
// couvre les deux types : typeAnomalie doit valoir exactement le type de
// l'anomalie qualifiée (sinon 409, la mise à jour ne trouve aucune ligne).
export function qualifierFraisVehicule(
  cabinetId: string,
  id: string,
  utilisateurId: string,
  typeAnomalie: string,
  type: 'confirme' | 'ignore'
): Promise<void> {
  return request<void>(`/anomalies/${id}/qualifier-frais-vehicule`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId, typeAnomalie, type }),
  });
}

// "Vérifier à nouveau" pour les DEUX types de frais véhicule (brief v48) —
// même route, un seul appel, comme verifierTvaHotel.
export function verifierFraisVehicule(
  cabinetId: string,
  dossierId: string,
  params: { periodeDebut: string; periodeFin: string; utilisateurId: string }
): Promise<{ anomaliesOuvertes: number; corrections: number }> {
  return request<{ anomaliesOuvertes: number; corrections: number }>(`/dossiers/${dossierId}/verifier-frais-vehicule`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(params),
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

// Un lien <a href> classique ne peut pas envoyer le header Authorization
// (nécessaire pour l'authentification côté serveur) — on récupère donc le
// CSV via fetch, puis on déclenche le téléchargement navigateur nous-mêmes
// via une URL objet temporaire.
export async function telechargerExportAudit(
  cabinetId: string,
  dossierId: string,
  filtres: { typeEvenement?: string; acteur?: string } = {}
): Promise<void> {
  void cabinetId;
  const params = new URLSearchParams();
  if (filtres.typeEvenement) params.set('typeEvenement', filtres.typeEvenement);
  if (filtres.acteur) params.set('acteur', filtres.acteur);
  const query = params.toString() ? `?${params.toString()}` : '';

  // Fetch brut (pas de JSON, réponse CSV) — même remplacement d'en-tête que
  // request() ci-dessus, cf. brief v25.
  const response = await fetch(`${BASE_URL}/dossiers/${dossierId}/audit/export${query}`, {
    headers: jetonActuel ? { Authorization: `Bearer ${jetonActuel}` } : {},
  });
  if (response.status === 401) {
    gestionnaireNonAutorise?.();
  }
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

// pennylaneToken retiré (brief v27, chantier API Cabinet) — le backend
// résout maintenant lui-même le client Pennylane à partir du paramètre
// cabinet pennylane_firm_api_key et de l'external_company_id du dossier,
// plus rien à fournir manuellement ici.
export interface ParametresCycle {
  periodeDebut: string;
  periodeFin: string;
  comptesVenteService?: string[];
  comptesChargeService?: string[];
  comptesEquipement?: string[];
  comptesCarburant?: string[];
}

// 409 (ApiError.status) dans trois cas désormais (brief v34) — géré par
// l'appelant, pas ici (message déjà porté par ApiError, corps déjà porté
// par ApiError.corps pour les deux premiers, pour rediriger sans second
// appel réseau) :
// - comptesACategoriser non vide : des comptes produit/charge restent à
//   catégoriser (porte obligatoire, jamais rattrapée après coup).
// - facturesARapprocher non vide : des factures de service achats restent
//   à rapprocher de leurs paiements (même principe).
// - aucun des deux ci-dessus : un calcul déjà validé/déclaré existe sur
//   cette période (comportement historique).
// 400 si aucun jeton cabinet Pennylane n'est configuré (message backend
// déjà clair, affiché tel quel par l'appelant).
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

// Consultable à tout moment, pas seulement en réaction à un 409 (brief
// v34) — vérification légère sans passer par un cycle complet.
// Réponse à deux champs (brief v46) — comptesServiceSansSousCategorieAutoliquidation
// est un second motif de blocage distinct, plus seulement comptesACategoriser.
export function fetchComptesACategoriser(
  cabinetId: string,
  dossierId: string,
  periodeDebut: string,
  periodeFin: string
): Promise<ResultatComptesACategoriser> {
  const params = new URLSearchParams({ periodeDebut, periodeFin });
  return request<ResultatComptesACategoriser>(`/dossiers/${dossierId}/comptes-a-categoriser?${params}`, cabinetId);
}

// Écran dédié "comptes TVA à confirmer" (brief v46, 4e porte obligatoire) —
// consultable à tout moment, pas seulement en réaction au 409 du lancement
// de cycle, même principe que fetchComptesACategoriser ci-dessus.
export function fetchComptesTvaAConfirmer(
  cabinetId: string,
  dossierId: string,
  periodeDebut: string,
  periodeFin: string
): Promise<CompteTvaAConfirmer[]> {
  const params = new URLSearchParams({ periodeDebut, periodeFin });
  return request<CompteTvaAConfirmer[]>(`/dossiers/${dossierId}/comptes-tva-a-confirmer?${params}`, cabinetId);
}

export function fetchRapprochementsPaiementAchat(
  cabinetId: string,
  dossierId: string,
  periodeDebut: string,
  periodeFin: string
): Promise<FactureARapprocher[]> {
  const params = new URLSearchParams({ periodeDebut, periodeFin });
  return request<FactureARapprocher[]>(`/dossiers/${dossierId}/rapprochements-paiement-achat?${params}`, cabinetId);
}

// Popup unique à onglets pour les 4 portes obligatoires (brief v58) — un
// seul appel au lieu des 3 routes séparées ci-dessus + une détection
// indirecte pour le parc de véhicules (auparavant seulement visible via un
// message d'erreur au lancement du cycle).
// signal optionnel (brief v61) : appel potentiellement lent (cf. chantier
// de performance backend en cours) — permet à l'appelant d'annuler
// réellement une requête devenue obsolète (React StrictMode double-invoque
// les effets en dev, sans signal les deux appels partaient réellement en
// parallèle vers le serveur) plutôt que de seulement ignorer son résultat.
export function fetchPortesObligatoires(
  cabinetId: string,
  dossierId: string,
  periodeDebut: string,
  periodeFin: string,
  signal?: AbortSignal
): Promise<EtatPortesObligatoires> {
  const params = new URLSearchParams({ periodeDebut, periodeFin });
  return request<EtatPortesObligatoires>(`/dossiers/${dossierId}/portes-obligatoires?${params}`, cabinetId, {
    ...(signal ? { signal } : {}),
  });
}

// paiementsValides peut être vide — le collaborateur estime qu'aucun
// candidat ne correspond, jamais une erreur.
export function enregistrerRapprochementPaiementAchat(
  cabinetId: string,
  dossierId: string,
  parametres: ParametresRapprochementPaiementAchat
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/rapprochements-paiement-achat`, cabinetId, {
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
  parametres: { periodeDebut: string; periodeFin: string; utilisateurId: string }
): Promise<{ motifPropose: MotifNumerotation | null }> {
  return request<{ motifPropose: MotifNumerotation | null }>(`/dossiers/${dossierId}/motif-numerotation/analyser`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(parametres),
  });
}

// Auto-découverte des dossiers déjà gérés sous Pennylane (chantier API
// Cabinet, brief v27) — réservée à admin_cabinet côté backend (403 sinon).
// 400 si aucun jeton cabinet Pennylane n'est configuré, 502 si l'appel à
// l'API Cabinet Pennylane échoue — les deux portent déjà un message clair.
export function synchroniserDossiers(cabinetId: string): Promise<ResultatSynchronisationDossiers> {
  return request<ResultatSynchronisationDossiers>('/synchroniser-dossiers', cabinetId, { method: 'POST' });
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

// --- Ajustement manuel des montants de TVA (brief v23) — restreint aux
// calculs encore 'brouillon' côté backend (409 sinon).
export function fetchAjustementsCalcul(cabinetId: string, calculId: string): Promise<AjustementCalcul[]> {
  return request<AjustementCalcul[]>(`/calculs/${calculId}/ajustements`, cabinetId);
}

// Détail persistant par catégorie (brief v44) — toujours 8 lignes, même à
// 0 ; `ajuste: true` signifie que le montant reflète un ajustement manuel
// (avoir, véhicule tourisme, immobilisation, taux collecte...) plutôt que
// la simple somme brute du cycle. Comble le trou laissé par
// fetchAjustementsCalcul ci-dessus, qui ne connaît que les deux totaux
// agrégés collectee_totale/deductible_totale — invisible pour un
// transfert entre deux catégories précises.
export function fetchDetailCalcul(cabinetId: string, calculId: string): Promise<DetailCalculLigne[]> {
  return request<DetailCalculLigne[]>(`/calculs/${calculId}/detail`, cabinetId);
}

// Onglet Déclaration (brief v49) — première version, affichage seulement.
export function fetchDeclarationCalcul(cabinetId: string, calculId: string): Promise<DeclarationCalcul> {
  return request<DeclarationCalcul>(`/calculs/${calculId}/declaration`, cabinetId);
}

export function ajusterMontantCalcul(
  cabinetId: string,
  calculId: string,
  params: {
    typeMontant: TypeMontantAjustement;
    montantOriginal: number;
    montantAjuste: number;
    justification: string;
    utilisateurId: string;
  }
): Promise<void> {
  return request<void>(`/calculs/${calculId}/ajustements`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function retirerAjustementCalcul(
  cabinetId: string,
  calculId: string,
  typeMontant: TypeMontantAjustement,
  utilisateurId: string
): Promise<void> {
  return request<void>(`/calculs/${calculId}/ajustements/${typeMontant}/retirer`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ utilisateurId }),
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

export function fetchDossiers(cabinetId: string, q?: string, statut?: string): Promise<Dossier[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (statut) params.set('statut', statut);
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<Dossier[]>(`/dossiers${query}`, cabinetId);
}

// Confirmation de la configuration fiscale d'un dossier nouvellement
// découvert (brief v28) — fait passer statut='onboarding' à 'actif'.
export function configurerDossierOnboarding(
  cabinetId: string,
  dossierId: string,
  configuration: ConfigurationOnboarding
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/configurer-onboarding`, cabinetId, {
    method: 'POST',
    body: JSON.stringify(configuration),
  });
}

// --- Identité complète d'un dossier (brief v29) ---

export function fetchDossierComplet(cabinetId: string, dossierId: string): Promise<DossierComplet> {
  return request<DossierComplet>(`/dossiers/${dossierId}/complet`, cabinetId);
}

// Mise à jour partielle — seuls les champs présents dans infos sont
// envoyés/modifiés.
export function mettreAJourIdentiteDossier(
  cabinetId: string,
  dossierId: string,
  infos: InfosIdentiteDossier
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/identite`, cabinetId, {
    method: 'PUT',
    body: JSON.stringify(infos),
  });
}

// Activation/désactivation d'un dossier, réservé admin_cabinet côté
// backend — motifDesactivation ignoré/effacé automatiquement si statut
// repasse à 'actif'.
export function definirStatutDossier(
  cabinetId: string,
  dossierId: string,
  statut: 'actif' | 'inactif',
  motifDesactivation?: string
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/statut`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ statut, motifDesactivation }),
  });
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

// Fournisseur ayant opté pour la TVA sur les débits (brief v56) : sa TVA
// est déductible dès facturation, sans attendre le paiement du service.
export function definirOpteTvaDebitsTiers(
  cabinetId: string,
  dossierId: string,
  numeroCompteTiers: string,
  opteTvaDebits: boolean
): Promise<void> {
  return request<void>(`/dossiers/${dossierId}/tiers/opte-tva-debits`, cabinetId, {
    method: 'POST',
    body: JSON.stringify({ numeroCompteTiers, opteTvaDebits }),
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
  vehicule: {
    designation?: string;
    typeBien: TypeBienVehicule;
    montantHt?: number;
    dateAcquisition?: string;
    typeCarburant?: TypeCarburant;
  },
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
