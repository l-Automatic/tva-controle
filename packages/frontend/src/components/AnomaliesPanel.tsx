import { useEffect, useState } from 'react';
import { CheckCheck, RefreshCw } from 'lucide-react';
import {
  ApiError,
  fetchAnomalies,
  justifierAnomalie,
  qualifierAvoir,
  qualifierEncaissement,
  qualifierImmobilisation,
  qualifierVehiculeTourisme,
  resoudreAnomalie,
  resoudreAnomaliesEnMasse,
  verifierAvoirs,
  verifierComptesNonReconnus,
  verifierImmobilisation,
  verifierVehiculeTourisme,
} from '../api';
import { toDateOnly } from '../dateUtils';
import { ICONE_ACTION, iconeTypeAnomalie } from '../icons';
import { useToast } from '../toast';
import type { Anomalie, GraviteAnomalie, StatutAnomalie } from '../types';
import { Accordion } from './Accordion';
import { BadgeStatut } from './BadgeStatut';

// Cas le plus fréquent en pratique : un compte de TVA non reconnu se
// résout en confirmant une convention d'autoliquidation, pas via
// Résoudre/Justifier — d'où le lien direct vers Conventions génériques et
// la vérification ciblée, sans repasser par un cycle complet (brief v30).
const TYPE_COMPTE_TVA_NON_RECONNU = 'compte_tva_non_reconnu';

// Qualification structurée plutôt que Résoudre/Justifier — un avoir/une
// OD de régularisation n'a pas besoin d'un commentaire libre, juste de
// savoir laquelle des deux c'est (brief v37, couvre désormais aussi les
// achats, pas seulement les ventes).
const TYPE_AVOIR_A_VERIFIER = 'avoir_a_verifier';

// Refonte complète (brief v40) : ce n'est plus un signalement systématique
// dès qu'un véhicule de tourisme existe dans le parc, mais un jugement IA
// ciblé sur les écritures d'achat (compte 2182) avec TVA effectivement
// déduite — même famille de qualification structurée que avoir_a_verifier.
const TYPE_VEHICULE_TOURISME_A_VERIFIER = 'immobilisation_vehicule_tourisme_a_verifier';

// Même schéma que avoir_a_verifier/immobilisation_vehicule_tourisme_a_verifier
// (brief v41), particularité : une correction ne change jamais le total de
// TVA déductible, elle transfère un montant entre deux catégories du calcul
// (deductible_abs -> deductible_immo), déjà affichées séparément par
// CycleForm.tsx (LIBELLE_CATEGORIE) — rien à changer de ce côté.
const TYPE_IMMOBILISATION_A_VERIFIER = 'immobilisation_potentielle_non_passee';

// 11 des 14 types du catalogue ont un libellé dédié ici — cf.
// CATALOGUE_ANOMALIES.md ; les 3 restants (incoherence_taux_autoliquidation,
// immobilisation_sur_compte_tva_incorrect, autoliquidation_incomplete)
// retombent sur le type brut en repli, hors périmètre de ce brief.
// ligne_tiers_introuvable et nature_operation_indeterminee retirées du
// catalogue côté backend — résidu purement frontend retiré ici (brief
// v33). flotte_mixte_carburant retirée pour la même raison en vérifiant
// ce même brief — même changelog de retrait (10/08) que
// ligne_tiers_introuvable dans CATALOGUE_ANOMALIES.md, aucune trace non
// plus dans le code backend. paiement_partiel_a_verifier et
// paiement_partiel_calcule retirées en brief v35, nature_operation_mixte
// en brief v36 — les deux dernières ne sont plus des anomalies du tout,
// remplacées par le champ prorataAppliques d'un cycle (affiché dans le
// panneau de calcul pour sens='collecte', déjà visible dans le popup de
// rapprochement pour sens='deductible').
const LIBELLE_TYPE_ANOMALIE: Record<string, string> = {
  compte_tva_non_reconnu: 'Compte de TVA non reconnu',
  encaissement_non_affecte: 'Encaissement non affecté',
  avoir_a_verifier: 'Avoir à vérifier',
  immobilisation_vehicule_tourisme_a_verifier: 'Véhicule de tourisme à vérifier',
  parc_vehicules_non_renseigne: 'Parc de véhicules non renseigné',
  immobilisation_potentielle_non_passee: 'Immobilisation potentielle non passée',
  nouveau_tiers_a_verifier: 'Nouveau tiers à vérifier',
  encaissement_client_taux_applique: 'Encaissement client — taux appliqué',
  tva_hotel_a_verifier: 'TVA hôtel à vérifier',
  tva_hotel_a_tort: 'TVA hôtel déduite à tort',
  trou_numerotation_facture: 'Trou dans la numérotation des factures',
  doublon_numerotation_facture: 'Doublon de numérotation de facture',
};

interface AnomaliesPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // 'cycle' : anomalies d'une période précise (vue fusionnée du cycle en
  // cours), sans filtres avancés. 'historique' (défaut) : toutes périodes,
  // filtrables par type et statut — cf. brief refonte, zones Cycle/Historique.
  variant?: 'cycle' | 'historique';
  periode?: string | null;
  // Bornes exactes du cycle en cours (variant='cycle' uniquement) — sert de
  // valeur par défaut pour "Vérifier à nouveau" (brief v30), pour ne pas
  // redemander une période déjà connue du contexte.
  periodeFin?: string | null;
  // Optionnel : incrémenté par le parent pour forcer un rechargement après
  // un nouveau cycle (brief v14) — sans lui, relancer un cycle sur EXACTEMENT
  // la même période ne change pas la valeur de `periode` (une simple
  // chaîne), donc l'effet ci-dessous ne se redéclenche pas et les nouvelles
  // anomalies persistées entre les deux cycles restent invisibles jusqu'à
  // un clic manuel sur "Rafraîchir". Même pattern que PropositionsPanel.
  refreshKey?: number;
  // Amène l'utilisateur vers Conventions génériques pour une anomalie
  // compte_tva_non_reconnu (brief v30) — non fourni si l'appelant ne gère
  // pas la navigation entre zones (aucun bouton affiché dans ce cas).
  onCompteNonReconnuClic?: ((anomalie: Anomalie) => void) | undefined;
  // Bug réel (brief v32) : Résoudre/Justifier/qualifier ne rafraîchissaient
  // que cette liste elle-même, jamais le panneau "Calcul de la période"
  // (v31, sticky) — composant séparé avec son propre refreshKey, sans
  // lien avec celui-ci. Même famille de problème que v14/v21. Optionnel :
  // seul le variant='cycle' de CycleZone.tsx a un panneau Calcul à
  // notifier.
  onAnomalieChangee?: (() => void) | undefined;
}

const LIBELLE_STATUT: Record<StatutAnomalie, string> = {
  ouvert: 'Ouverte',
  resolu: 'Résolue',
  justifie: 'Justifiée',
};

const LIBELLE_GRAVITE: Record<GraviteAnomalie, string> = {
  bloquant: 'Bloquant',
  signale: 'Signalé',
  info: 'Info',
};

const TAUX_TVA = ['20', '10', '5.5', '2.1'];

function detailsMontant(details: unknown): { montantTTC: number | null; date: string | null } {
  if (!details || typeof details !== 'object') return { montantTTC: null, date: null };
  const d = details as Record<string, unknown>;
  return {
    montantTTC: typeof d.montantTTC === 'number' ? d.montantTTC : null,
    date: typeof d.date === 'string' ? d.date : null,
  };
}

// Le libellé de la pièce (quand Pennylane le renseigne) est bien plus
// exploitable que l'ID technique pour retrouver une écriture — devient la
// référence principale affichée (cf. brief v5). `exemplesLibelle` regroupe
// plusieurs écritures (ex : compte_tva_non_reconnu) ; `libelle` est
// singulier sur les autres types. Jamais les deux à la fois.
function libellesDePiece(details: unknown): string[] {
  if (!details || typeof details !== 'object') return [];
  const d = details as Record<string, unknown>;
  if (Array.isArray(d.exemplesLibelle)) {
    return d.exemplesLibelle.filter((l): l is string => typeof l === 'string');
  }
  return typeof d.libelle === 'string' ? [d.libelle] : [];
}

// Champs déjà affichés séparément (libellé(s), montant, date) — le reste
// (ex : tauxImplicite/tauxAttendu, nbEcritures/references) garde un intérêt
// de vérification, affiché en JSON compact plutôt que perdu.
const CLES_DEJA_AFFICHEES = new Set(['libelle', 'exemplesLibelle', 'montantTTC', 'date']);

function detailsResiduels(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  // Cas concret (type d'anomalie retiré depuis, brief v35 — conservé au
  // cas où une future anomalie de groupe de lettrage réapparaîtrait) : le
  // compte tiers (411/401) et les autres pièces du groupe sont la seule
  // info qui permette d'aller vérifier manuellement dans Pennylane ; le champ
  // `compte` de l'anomalie est le compte TVA, pas le compte tiers, d'où le
  // besoin de l'afficher séparément plutôt que de laisser croire que
  // "Compte : 445711" est le compte client/fournisseur concerné.
  if (Array.isArray(d.groupeIds)) {
    const compteTiers = typeof d.compteTiers === 'string' ? `Compte tiers : ${d.compteTiers} — ` : '';
    return `${compteTiers}Autres pièces du même groupe de lettrage : ${d.groupeIds.join(', ')}`;
  }
  const clesRestantes = Object.keys(d).filter((k) => !CLES_DEJA_AFFICHEES.has(k));
  if (clesRestantes.length === 0) return null;
  const reste = Object.fromEntries(clesRestantes.map((k) => [k, d[k]]));
  return JSON.stringify(reste, null, 2);
}

// Qualification structurée d'un encaissement non affecté (compte d'attente
// 471) : "lié à une vente" (taux requis) ou "sans lien avec une vente"
// (motif requis) — remplace Résoudre/Justifier pour ce type d'anomalie
// précisément, cf. controles-module4/encaissementNonAffecte.ts.
function EncaissementQualification({
  anomalie,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [decision, setDecision] = useState<'vente' | 'hors_vente' | null>(null);
  const [taux, setTaux] = useState('');
  const [motif, setMotif] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflit, setConflit] = useState(false);
  const notifier = useToast();

  async function handleConfirmerVente() {
    if (!taux) {
      setError('Sélectionnez un taux de TVA');
      return;
    }
    setSubmitting(true);
    setError(null);
    setConflit(false);
    try {
      await qualifierEncaissement(cabinetId, anomalie.id, utilisateurId, {
        decision: 'vente',
        taux: Number.parseFloat(taux),
      });
      notifier('Encaissement qualifié');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec de la qualification');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmerHorsVente() {
    if (!motif.trim()) {
      setError('Un motif est requis pour qualifier « sans lien avec une vente »');
      return;
    }
    setSubmitting(true);
    setError(null);
    setConflit(false);
    try {
      await qualifierEncaissement(cabinetId, anomalie.id, utilisateurId, {
        decision: 'hors_vente',
        motif: motif.trim(),
      });
      notifier('Encaissement qualifié');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec de la qualification');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {decision === null && (
        <div className="actions">
          <button onClick={() => setDecision('vente')} disabled={submitting}>
            <ICONE_ACTION.qualifier size={14} aria-hidden="true" />
            Lié à une vente
          </button>
          <button onClick={() => setDecision('hors_vente')} className="secondary" disabled={submitting}>
            Sans lien avec une vente
          </button>
        </div>
      )}

      {decision === 'vente' && (
        <div className="actions">
          <select value={taux} onChange={(e) => setTaux(e.target.value)} disabled={submitting}>
            <option value="">Taux de TVA…</option>
            {TAUX_TVA.map((t) => (
              <option key={t} value={t}>
                {t.replace('.', ',')} %
              </option>
            ))}
          </select>
          <button onClick={() => void handleConfirmerVente()} disabled={submitting}>
            <ICONE_ACTION.confirmer size={14} aria-hidden="true" />
            {submitting ? '…' : 'Confirmer'}
          </button>
          <button onClick={() => setDecision(null)} className="secondary" disabled={submitting}>
            Annuler
          </button>
        </div>
      )}

      {decision === 'hors_vente' && (
        <div className="actions">
          <input
            type="text"
            placeholder="Motif (requis)"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            disabled={submitting}
          />
          <button onClick={() => void handleConfirmerHorsVente()} disabled={submitting}>
            <ICONE_ACTION.confirmer size={14} aria-hidden="true" />
            {submitting ? '…' : 'Confirmer'}
          </button>
          <button onClick={() => setDecision(null)} className="secondary" disabled={submitting}>
            Annuler
          </button>
        </div>
      )}
      {error && <p className={conflit ? 'error error-409' : 'error'}>{error}</p>}
    </>
  );
}

// Vérification ciblée, sans cycle complet (brief v30) — periodeFin par
// défaut vient du contexte cycle quand connu, sinon repli sur la seule date
// que porte l'anomalie (periodeDebut du cycle qui l'a générée), modifiable.
function VerificationComptesNonReconnus({
  cabinetId,
  dossierId,
  anomalie,
  periodeFinContexte,
  onChanged,
}: {
  cabinetId: string;
  dossierId: string;
  anomalie: Anomalie;
  periodeFinContexte?: string | null;
  onChanged: () => void;
}) {
  const debutParDefaut = toDateOnly(anomalie.periode);
  const [ouvert, setOuvert] = useState(false);
  const [periodeDebut, setPeriodeDebut] = useState(debutParDefaut);
  const [periodeFin, setPeriodeFin] = useState(periodeFinContexte ? toDateOnly(periodeFinContexte) : debutParDefaut);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleVerifier() {
    setSubmitting(true);
    setError(null);
    try {
      const { anomalies } = await verifierComptesNonReconnus(cabinetId, dossierId, { periodeDebut, periodeFin });
      notifier(
        anomalies === 0
          ? 'Aucun compte non reconnu sur cette période — anomalie levée'
          : `${anomalies} compte(s) toujours non reconnu(s) sur cette période`
      );
      setOuvert(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la vérification');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ouvert) {
    return (
      <button className="secondary" onClick={() => setOuvert(true)}>
        <RefreshCw size={14} aria-hidden="true" />
        Vérifier à nouveau
      </button>
    );
  }

  return (
    <div className="cycle-form">
      <label>
        Période — début
        <input type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Période — fin
        <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} disabled={submitting} />
      </label>
      <button onClick={() => void handleVerifier()} disabled={submitting}>
        {submitting ? 'Vérification…' : 'Vérifier'}
      </button>
      <button className="secondary" onClick={() => setOuvert(false)} disabled={submitting}>
        Annuler
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Qualification structurée pour avoir_a_verifier (brief v37) — remplace
// Résoudre/Justifier pour ce type précisément : "Avoir" ou "OD de
// régularisation", jamais un commentaire libre. Ne touche jamais le
// calcul (juste une trace de décision) — distinct de "Vérifier à
// nouveau" ci-dessous, qui lui peut ajuster le calcul.
function QualificationAvoir({
  anomalie,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState<'avoir' | 'od' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleQualifier(type: 'avoir' | 'od') {
    setSubmitting(type);
    setError(null);
    try {
      await qualifierAvoir(cabinetId, anomalie.id, utilisateurId, type);
      notifier(type === 'avoir' ? 'Qualifié comme avoir' : 'Qualifié comme OD de régularisation');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la qualification');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <>
      <div className="actions">
        <button onClick={() => void handleQualifier('avoir')} disabled={submitting !== null}>
          <ICONE_ACTION.qualifier size={14} aria-hidden="true" />
          {submitting === 'avoir' ? '…' : 'Avoir'}
        </button>
        <button onClick={() => void handleQualifier('od')} className="secondary" disabled={submitting !== null}>
          {submitting === 'od' ? '…' : 'OD de régularisation'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

// "Vérifier à nouveau" pour avoir_a_verifier (brief v37) — distinct de la
// qualification ci-dessus : "je pense l'avoir corrigé dans Pennylane,
// vérifie et corrige le calcul si besoin". Si le débit/crédit litigieux a
// bien été corrigé, l'anomalie disparaît au prochain chargement ET le
// calcul brouillon existant est ajusté automatiquement côté backend —
// onChanged() ici déclenche déjà le rafraîchissement du panneau de calcul
// (même fil que Résoudre/Justifier/qualifier, cf. brief v32).
function VerificationAvoirs({
  cabinetId,
  dossierId,
  utilisateurId,
  anomalie,
  periodeFinContexte,
  onChanged,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  anomalie: Anomalie;
  periodeFinContexte?: string | null;
  onChanged: () => void;
}) {
  const debutParDefaut = toDateOnly(anomalie.periode);
  const [ouvert, setOuvert] = useState(false);
  const [periodeDebut, setPeriodeDebut] = useState(debutParDefaut);
  const [periodeFin, setPeriodeFin] = useState(periodeFinContexte ? toDateOnly(periodeFinContexte) : debutParDefaut);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleVerifier() {
    setSubmitting(true);
    setError(null);
    try {
      const { anomaliesOuvertes, corrections } = await verifierAvoirs(cabinetId, dossierId, {
        periodeDebut,
        periodeFin,
        utilisateurId,
      });
      notifier(
        corrections > 0
          ? `${corrections} correction(s) appliquée(s) au calcul — montant mis à jour`
          : `Aucune correction détectée — ${anomaliesOuvertes} anomalie(s) avoir toujours ouverte(s) sur cette période`
      );
      setOuvert(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la vérification');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ouvert) {
    return (
      <button className="secondary" onClick={() => setOuvert(true)}>
        <RefreshCw size={14} aria-hidden="true" />
        Vérifier à nouveau
      </button>
    );
  }

  return (
    <div className="cycle-form">
      <label>
        Période — début
        <input type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Période — fin
        <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} disabled={submitting} />
      </label>
      <button onClick={() => void handleVerifier()} disabled={submitting}>
        {submitting ? 'Vérification…' : 'Vérifier'}
      </button>
      <button className="secondary" onClick={() => setOuvert(false)} disabled={submitting}>
        Annuler
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Qualification structurée pour immobilisation_vehicule_tourisme_a_verifier
// (brief v40) — même principe que QualificationAvoir : ne touche jamais le
// calcul (juste une trace de décision), distinct de "Vérifier à nouveau"
// ci-dessous qui lui peut ajuster le calcul.
function QualificationVehiculeTourisme({
  anomalie,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState<'confirme_tourisme' | 'pas_tourisme' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleQualifier(type: 'confirme_tourisme' | 'pas_tourisme') {
    setSubmitting(type);
    setError(null);
    try {
      await qualifierVehiculeTourisme(cabinetId, anomalie.id, utilisateurId, type);
      notifier(type === 'confirme_tourisme' ? 'Véhicule de tourisme confirmé' : "Qualifié comme n'étant pas un véhicule de tourisme");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la qualification');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <>
      <div className="actions">
        <button onClick={() => void handleQualifier('confirme_tourisme')} disabled={submitting !== null}>
          <ICONE_ACTION.qualifier size={14} aria-hidden="true" />
          {submitting === 'confirme_tourisme' ? '…' : 'Confirmer véhicule de tourisme'}
        </button>
        <button onClick={() => void handleQualifier('pas_tourisme')} className="secondary" disabled={submitting !== null}>
          {submitting === 'pas_tourisme' ? '…' : "Ce n'est pas un véhicule de tourisme"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

// "Vérifier à nouveau" pour immobilisation_vehicule_tourisme_a_verifier
// (brief v40) — même principe que VerificationAvoirs : "je pense l'avoir
// corrigé dans Pennylane, vérifie et corrige le calcul si besoin".
function VerificationVehiculeTourisme({
  cabinetId,
  dossierId,
  utilisateurId,
  anomalie,
  periodeFinContexte,
  onChanged,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  anomalie: Anomalie;
  periodeFinContexte?: string | null;
  onChanged: () => void;
}) {
  const debutParDefaut = toDateOnly(anomalie.periode);
  const [ouvert, setOuvert] = useState(false);
  const [periodeDebut, setPeriodeDebut] = useState(debutParDefaut);
  const [periodeFin, setPeriodeFin] = useState(periodeFinContexte ? toDateOnly(periodeFinContexte) : debutParDefaut);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleVerifier() {
    setSubmitting(true);
    setError(null);
    try {
      const { anomaliesOuvertes, corrections } = await verifierVehiculeTourisme(cabinetId, dossierId, {
        periodeDebut,
        periodeFin,
        utilisateurId,
      });
      notifier(
        corrections > 0
          ? `${corrections} correction(s) appliquée(s) au calcul — montant mis à jour`
          : `Aucune correction détectée — ${anomaliesOuvertes} anomalie(s) véhicule de tourisme toujours ouverte(s) sur cette période`
      );
      setOuvert(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la vérification');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ouvert) {
    return (
      <button className="secondary" onClick={() => setOuvert(true)}>
        <RefreshCw size={14} aria-hidden="true" />
        Vérifier à nouveau
      </button>
    );
  }

  return (
    <div className="cycle-form">
      <label>
        Période — début
        <input type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Période — fin
        <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} disabled={submitting} />
      </label>
      <button onClick={() => void handleVerifier()} disabled={submitting}>
        {submitting ? 'Vérification…' : 'Vérifier'}
      </button>
      <button className="secondary" onClick={() => setOuvert(false)} disabled={submitting}>
        Annuler
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Qualification structurée pour immobilisation_potentielle_non_passee
// (brief v41) — même principe que QualificationAvoir/QualificationVehiculeTourisme :
// ne touche jamais le calcul (juste une trace de décision), distinct de
// "Vérifier à nouveau" ci-dessous qui lui peut ajuster le calcul.
function QualificationImmobilisation({
  anomalie,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState<'confirme_immo' | 'ignore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleQualifier(type: 'confirme_immo' | 'ignore') {
    setSubmitting(type);
    setError(null);
    try {
      await qualifierImmobilisation(cabinetId, anomalie.id, utilisateurId, type);
      notifier(type === 'confirme_immo' ? 'Immobilisation confirmée' : "Qualifié comme n'étant pas une immobilisation");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la qualification');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <>
      <div className="actions">
        <button onClick={() => void handleQualifier('confirme_immo')} disabled={submitting !== null}>
          <ICONE_ACTION.qualifier size={14} aria-hidden="true" />
          {submitting === 'confirme_immo' ? '…' : "C'est bien une immobilisation"}
        </button>
        <button onClick={() => void handleQualifier('ignore')} className="secondary" disabled={submitting !== null}>
          {submitting === 'ignore' ? '…' : "Ce n'est pas une immobilisation"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

// "Vérifier à nouveau" pour immobilisation_potentielle_non_passee (brief
// v41) — même principe que VerificationAvoirs/VerificationVehiculeTourisme :
// "je pense l'avoir reclassée dans Pennylane, vérifie et corrige le calcul
// si besoin". Ici, la correction transfère un montant entre deductible_abs
// et deductible_immo plutôt que de changer le total déductible — le toast
// reste formulé en "correction(s) appliquée(s)" sans détailler le
// transfert, le panneau de calcul (deux lignes déjà distinctes) suffit à le
// rendre visible une fois rafraîchi.
function VerificationImmobilisation({
  cabinetId,
  dossierId,
  utilisateurId,
  anomalie,
  periodeFinContexte,
  onChanged,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  anomalie: Anomalie;
  periodeFinContexte?: string | null;
  onChanged: () => void;
}) {
  const debutParDefaut = toDateOnly(anomalie.periode);
  const [ouvert, setOuvert] = useState(false);
  const [periodeDebut, setPeriodeDebut] = useState(debutParDefaut);
  const [periodeFin, setPeriodeFin] = useState(periodeFinContexte ? toDateOnly(periodeFinContexte) : debutParDefaut);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleVerifier() {
    setSubmitting(true);
    setError(null);
    try {
      const { anomaliesOuvertes, corrections } = await verifierImmobilisation(cabinetId, dossierId, {
        periodeDebut,
        periodeFin,
        utilisateurId,
      });
      notifier(
        corrections > 0
          ? `${corrections} correction(s) appliquée(s) au calcul — transfert charges/immobilisations effectué`
          : `Aucune correction détectée — ${anomaliesOuvertes} anomalie(s) immobilisation toujours ouverte(s) sur cette période`
      );
      setOuvert(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la vérification');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ouvert) {
    return (
      <button className="secondary" onClick={() => setOuvert(true)}>
        <RefreshCw size={14} aria-hidden="true" />
        Vérifier à nouveau
      </button>
    );
  }

  return (
    <div className="cycle-form">
      <label>
        Période — début
        <input type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Période — fin
        <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} disabled={submitting} />
      </label>
      <button onClick={() => void handleVerifier()} disabled={submitting}>
        {submitting ? 'Vérification…' : 'Vérifier'}
      </button>
      <button className="secondary" onClick={() => setOuvert(false)} disabled={submitting}>
        Annuler
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function AnomalieRow({
  anomalie,
  cabinetId,
  dossierId,
  utilisateurId,
  periodeFinContexte = null,
  onCompteNonReconnuClic,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periodeFinContexte?: string | null;
  onCompteNonReconnuClic?: ((anomalie: Anomalie) => void) | undefined;
  onChanged: () => void;
}) {
  const [commentaire, setCommentaire] = useState('');
  const [submitting, setSubmitting] = useState<'resoudre' | 'justifier' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleResoudre() {
    setSubmitting('resoudre');
    setError(null);
    try {
      await resoudreAnomalie(cabinetId, anomalie.id, utilisateurId, commentaire || undefined);
      notifier('Anomalie résolue');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la résolution');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleJustifier() {
    if (!commentaire.trim()) {
      setError('Un commentaire est requis pour justifier une anomalie');
      return;
    }
    setSubmitting('justifier');
    setError(null);
    try {
      await justifierAnomalie(cabinetId, anomalie.id, utilisateurId, commentaire);
      notifier('Anomalie justifiée');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la justification');
    } finally {
      setSubmitting(null);
    }
  }

  const estOuverte = anomalie.statut === 'ouvert';
  const estEncaissement = anomalie.typeAnomalie === 'encaissement_non_affecte';
  const estCompteNonReconnu = anomalie.typeAnomalie === TYPE_COMPTE_TVA_NON_RECONNU;
  const estAvoirAVerifier = anomalie.typeAnomalie === TYPE_AVOIR_A_VERIFIER;
  const estVehiculeTourismeAVerifier = anomalie.typeAnomalie === TYPE_VEHICULE_TOURISME_A_VERIFIER;
  const estImmobilisationAVerifier = anomalie.typeAnomalie === TYPE_IMMOBILISATION_A_VERIFIER;
  // Particularité de ce type (brief v41) : qualifier() passe IMMÉDIATEMENT
  // l'anomalie en 'resolu', y compris pour 'confirme_immo' — contrairement
  // à avoir_a_verifier/vehicule_tourisme_a_verifier, verifierImmobilisationLegere
  // rejoue le contrôle sur les anomalies déjà 'resolu' (pas 'ouvert'), donc
  // "Vérifier à nouveau" doit rester visible après qualification tant que
  // la décision était 'confirme_immo' — inutile si 'ignore' (rien à corriger).
  const resolutionImmoType =
    estImmobilisationAVerifier && anomalie.resolution && typeof anomalie.resolution === 'object'
      ? (anomalie.resolution as { type?: string }).type
      : null;
  const afficherVerificationImmobilisation = estImmobilisationAVerifier && (estOuverte || resolutionImmoType === 'confirme_immo');
  const detailsRestants = detailsResiduels(anomalie.details);
  const { montantTTC, date } = detailsMontant(anomalie.details);
  const libelles = libellesDePiece(anomalie.details);

  return (
    <li className={`card anomalie gravite-${anomalie.gravite}`}>
      <Accordion
        defaultOpen={estOuverte}
        titre={
          <span className="card-header">
            <BadgeStatut statut={anomalie.statut} libelle={LIBELLE_STATUT[anomalie.statut]} />
            <span className={`badge gravite-badge-${anomalie.gravite}`}>{LIBELLE_GRAVITE[anomalie.gravite]}</span>
            <span className="type-anomalie">
              {(() => {
                const Icone = iconeTypeAnomalie(anomalie.typeAnomalie);
                return <Icone size={13} aria-hidden="true" />;
              })()}
              {LIBELLE_TYPE_ANOMALIE[anomalie.typeAnomalie] ?? anomalie.typeAnomalie}
            </span>
          </span>
        }
        meta={<span className="periode">{anomalie.periode}</span>}
      >
        <p className="description">{anomalie.description}</p>
        {estEncaissement && montantTTC !== null && (
          <p className="label">
            Montant TTC : <strong>{montantTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</strong>
          </p>
        )}

        {/* Le libellé de la pièce est la référence principale — l'ID technique
            Pennylane passe en information secondaire (cf. brief v5). */}
        {libelles.length > 0 ? (
          <>
            {libelles.length === 1 ? (
              <p className="label piece-libelle">{libelles[0]}</p>
            ) : (
              <ul className="piece-libelles-liste">
                {libelles.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            <p className="reference piece-technique">
              (pièce {anomalie.referencePiece ?? '—'}
              {date ? ` — ${date}` : ''})
            </p>
          </>
        ) : (
          <p className="reference">
            {date ? `${date} — ` : ''}
            {anomalie.referencePiece ? `Pièce : ${anomalie.referencePiece}` : 'Pièce inconnue'}
          </p>
        )}

        {anomalie.compte && <p className="reference">Compte : {anomalie.compte}</p>}
        {detailsRestants && <p className="reference details">{detailsRestants}</p>}

        {estOuverte && estCompteNonReconnu && (
          <div className="actions">
            {onCompteNonReconnuClic && (
              <button onClick={() => onCompteNonReconnuClic(anomalie)}>
                Configurer la convention d'autoliquidation
              </button>
            )}
            <VerificationComptesNonReconnus
              cabinetId={cabinetId}
              dossierId={dossierId}
              anomalie={anomalie}
              periodeFinContexte={periodeFinContexte}
              onChanged={onChanged}
            />
          </div>
        )}

        {estOuverte && estAvoirAVerifier && (
          <div className="actions">
            <VerificationAvoirs
              cabinetId={cabinetId}
              dossierId={dossierId}
              utilisateurId={utilisateurId}
              anomalie={anomalie}
              periodeFinContexte={periodeFinContexte}
              onChanged={onChanged}
            />
          </div>
        )}

        {estOuverte && estVehiculeTourismeAVerifier && (
          <div className="actions">
            <VerificationVehiculeTourisme
              cabinetId={cabinetId}
              dossierId={dossierId}
              utilisateurId={utilisateurId}
              anomalie={anomalie}
              periodeFinContexte={periodeFinContexte}
              onChanged={onChanged}
            />
          </div>
        )}

        {afficherVerificationImmobilisation && (
          <div className="actions">
            <VerificationImmobilisation
              cabinetId={cabinetId}
              dossierId={dossierId}
              utilisateurId={utilisateurId}
              anomalie={anomalie}
              periodeFinContexte={periodeFinContexte}
              onChanged={onChanged}
            />
          </div>
        )}

        {estOuverte &&
          (estEncaissement ? (
            <EncaissementQualification
              anomalie={anomalie}
              cabinetId={cabinetId}
              utilisateurId={utilisateurId}
              onChanged={onChanged}
            />
          ) : estAvoirAVerifier ? (
            <QualificationAvoir anomalie={anomalie} cabinetId={cabinetId} utilisateurId={utilisateurId} onChanged={onChanged} />
          ) : estVehiculeTourismeAVerifier ? (
            <QualificationVehiculeTourisme
              anomalie={anomalie}
              cabinetId={cabinetId}
              utilisateurId={utilisateurId}
              onChanged={onChanged}
            />
          ) : estImmobilisationAVerifier ? (
            <QualificationImmobilisation
              anomalie={anomalie}
              cabinetId={cabinetId}
              utilisateurId={utilisateurId}
              onChanged={onChanged}
            />
          ) : (
            <div className="actions">
              <input
                type="text"
                placeholder="Commentaire (requis pour justifier)"
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                disabled={submitting !== null}
              />
              <button onClick={handleResoudre} disabled={submitting !== null}>
                <ICONE_ACTION.resoudre size={14} aria-hidden="true" />
                {submitting === 'resoudre' ? '…' : 'Résoudre'}
              </button>
              <button onClick={handleJustifier} disabled={submitting !== null} className="secondary">
                <ICONE_ACTION.justifier size={14} aria-hidden="true" />
                {submitting === 'justifier' ? '…' : 'Justifier'}
              </button>
            </div>
          ))}
        {estOuverte &&
          !estEncaissement &&
          !estAvoirAVerifier &&
          !estVehiculeTourismeAVerifier &&
          !estImmobilisationAVerifier &&
          error && <p className="error">{error}</p>}
      </Accordion>
    </li>
  );
}

const TOUS_STATUTS = 'tous';
const TOUS_TYPES = 'tous';

function ResolutionMasse({
  cabinetId,
  utilisateurId,
  anomalieIds,
  onResolues,
}: {
  cabinetId: string;
  utilisateurId: string;
  anomalieIds: string[];
  onResolues: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleConfirmer() {
    if (!commentaire.trim()) {
      setError('Un commentaire est requis pour une résolution groupée');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { nombreResolues } = await resoudreAnomaliesEnMasse(cabinetId, anomalieIds, utilisateurId, commentaire.trim());
      notifier(`${nombreResolues} anomalie(s) résolue(s)`);
      setOuvert(false);
      setCommentaire('');
      onResolues();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la résolution groupée');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ouvert) {
    return (
      <button onClick={() => setOuvert(true)} disabled={anomalieIds.length === 0}>
        <CheckCheck size={14} aria-hidden="true" />
        Tout résoudre ({anomalieIds.length})
      </button>
    );
  }

  return (
    <div className="actions">
      <input
        type="text"
        placeholder="Commentaire (requis, partagé pour tout le lot)"
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        disabled={submitting}
      />
      <button onClick={() => void handleConfirmer()} disabled={submitting}>
        {submitting ? '…' : `Résoudre les ${anomalieIds.length} anomalies`}
      </button>
      <button className="secondary" onClick={() => setOuvert(false)} disabled={submitting}>
        Annuler
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function AnomaliesPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  variant = 'historique',
  periode = null,
  periodeFin = null,
  refreshKey,
  onCompteNonReconnuClic,
  onAnomalieChangee,
}: AnomaliesPanelProps) {
  const [anomalies, setAnomalies] = useState<Anomalie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afficherTraitees, setAfficherTraitees] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState<typeof TOUS_STATUTS | StatutAnomalie>(TOUS_STATUTS);
  const [filtreType, setFiltreType] = useState(TOUS_TYPES);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnomalies(cabinetId, dossierId, periode ? { periode } : {});
      setAnomalies(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les anomalies');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, periode, refreshKey]);

  // Le filtre par type (filtreType) est partagé entre les deux variantes
  // (brief v40) — auparavant réservé à 'historique'. Le filtre principal de
  // statut reste propre à chaque variante : la case "Afficher les
  // anomalies traitées" pour 'cycle', le menu déroulant filtreStatut pour
  // 'historique'.
  const visibles = anomalies
    .filter((a) => (variant === 'cycle' ? afficherTraitees || a.statut === 'ouvert' : filtreStatut === TOUS_STATUTS || a.statut === filtreStatut))
    .filter((a) => filtreType === TOUS_TYPES || a.typeAnomalie === filtreType);
  const nbOuvertes = anomalies.filter((a) => a.statut === 'ouvert').length;
  const idsOuvertesVisibles = visibles.filter((a) => a.statut === 'ouvert').map((a) => a.id);

  return (
    <section className={variant === 'cycle' ? 'panel-section' : 'panel panel-full'}>
      <div className="panel-header">
        <h2>
          {variant === 'cycle' ? 'Anomalies de la période' : 'Anomalies'} ({nbOuvertes} ouverte
          {nbOuvertes === 1 ? '' : 's'})
        </h2>
        {variant === 'cycle' ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={afficherTraitees}
              onChange={(e) => setAfficherTraitees(e.target.checked)}
            />
            Afficher les anomalies traitées
          </label>
        ) : (
          <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value as StatutAnomalie)}>
            <option value={TOUS_STATUTS}>Tous les statuts</option>
            <option value="ouvert">Ouvertes</option>
            <option value="resolu">Résolues</option>
            <option value="justifie">Justifiées</option>
          </select>
        )}
        {/* Menu de filtrage par type — construit pour 'historique' (brief
            v12), étendu à 'cycle' (brief v40) : même state filtreType, même
            logique de filtrage appliquée dans `visibles` ci-dessus. */}
        <select value={filtreType} onChange={(e) => setFiltreType(e.target.value)}>
          <option value={TOUS_TYPES}>Tous les types</option>
          {Object.entries(LIBELLE_TYPE_ANOMALIE).map(([type, libelle]) => (
            <option key={type} value={type}>
              {libelle}
            </option>
          ))}
        </select>
        {variant !== 'cycle' && filtreType !== TOUS_TYPES && (
          <ResolutionMasse
            cabinetId={cabinetId}
            utilisateurId={utilisateurId}
            anomalieIds={idsOuvertesVisibles}
            onResolues={() => void charger()}
          />
        )}
        <button onClick={() => void charger()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" />
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && visibles.length === 0 && (
        <p className="empty">
          {variant === 'cycle' ? 'Aucune anomalie pour cette période.' : 'Aucune anomalie à afficher.'}
        </p>
      )}
      <ul className="card-list">
        {visibles.map((a) => (
          <AnomalieRow
            key={a.id}
            anomalie={a}
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            periodeFinContexte={periodeFin}
            onCompteNonReconnuClic={onCompteNonReconnuClic}
            onChanged={() => {
              void charger();
              onAnomalieChangee?.();
            }}
          />
        ))}
      </ul>
    </section>
  );
}
