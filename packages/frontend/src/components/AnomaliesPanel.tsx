import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  ApiError,
  fetchAnomalies,
  justifierAnomalie,
  qualifierEncaissement,
  resoudreAnomalie,
} from '../api';
import { ICONE_ACTION, iconeTypeAnomalie } from '../icons';
import { useToast } from '../toast';
import type { Anomalie, GraviteAnomalie, StatutAnomalie } from '../types';
import { BadgeStatut } from './BadgeStatut';

interface AnomaliesPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // 'cycle' : anomalies d'une période précise (vue fusionnée du cycle en
  // cours), sans filtres avancés. 'historique' (défaut) : toutes périodes,
  // filtrables par type et statut — cf. brief refonte, zones Cycle/Historique.
  variant?: 'cycle' | 'historique';
  periode?: string | null;
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

function detailsEncaissement(details: unknown): { montantTTC: number | null; libelle: string | null; date: string | null } {
  if (!details || typeof details !== 'object') return { montantTTC: null, libelle: null, date: null };
  const d = details as Record<string, unknown>;
  return {
    montantTTC: typeof d.montantTTC === 'number' ? d.montantTTC : null,
    libelle: typeof d.libelle === 'string' ? d.libelle : null,
    date: typeof d.date === 'string' ? d.date : null,
  };
}

function detailsLisibles(typeAnomalie: string, details: unknown): string | null {
  // Rendu dédié pour encaissement_non_affecte (montant TTC + libellé/date) —
  // voir EncaissementQualification, pas ce fallback générique.
  if (typeAnomalie === 'encaissement_non_affecte') return null;
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  // Cas concret : anomalies de groupe de lettrage (paiement_partiel_a_verifier)
  // — le compte tiers (411/401) et les autres pièces du groupe sont la seule
  // info qui permette d'aller vérifier manuellement dans Pennylane ; le champ
  // `compte` de l'anomalie est le compte TVA, pas le compte tiers, d'où le
  // besoin de l'afficher séparément plutôt que de laisser croire que
  // "Compte : 445711" est le compte client/fournisseur concerné.
  if (Array.isArray(d.groupeIds)) {
    const compteTiers = typeof d.compteTiers === 'string' ? `Compte tiers : ${d.compteTiers} — ` : '';
    return `${compteTiers}Autres pièces du même groupe de lettrage : ${d.groupeIds.join(', ')}`;
  }
  return JSON.stringify(details, null, 2);
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

function AnomalieRow({
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
  const details = detailsLisibles(anomalie.typeAnomalie, anomalie.details);
  const { montantTTC, libelle, date } = detailsEncaissement(anomalie.details);

  return (
    <li className={`card anomalie gravite-${anomalie.gravite}`}>
      <div className="card-header">
        <BadgeStatut statut={anomalie.statut} libelle={LIBELLE_STATUT[anomalie.statut]} />
        <span className={`badge gravite-badge-${anomalie.gravite}`}>{LIBELLE_GRAVITE[anomalie.gravite]}</span>
        <span className="type-anomalie">
          {(() => {
            const Icone = iconeTypeAnomalie(anomalie.typeAnomalie);
            return <Icone size={13} aria-hidden="true" />;
          })()}
          {anomalie.typeAnomalie}
        </span>
        <span className="periode">{anomalie.periode}</span>
      </div>
      <p className="description">{anomalie.description}</p>
      {estEncaissement && montantTTC !== null && (
        <p className="label">
          Montant TTC : <strong>{montantTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</strong>
        </p>
      )}
      {estEncaissement && (libelle || date) && (
        <p className="reference">
          {libelle}
          {libelle && date ? ' — ' : ''}
          {date}
        </p>
      )}
      {anomalie.compte && <p className="reference">Compte : {anomalie.compte}</p>}
      {anomalie.referencePiece && (
        <p className="reference">Pièce : {anomalie.referencePiece}</p>
      )}
      {details && <p className="reference details">{details}</p>}

      {estOuverte &&
        (estEncaissement ? (
          <EncaissementQualification
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
      {estOuverte && !estEncaissement && error && <p className="error">{error}</p>}
    </li>
  );
}

const TOUS_STATUTS = 'tous';

export function AnomaliesPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  variant = 'historique',
  periode = null,
}: AnomaliesPanelProps) {
  const [anomalies, setAnomalies] = useState<Anomalie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afficherTraitees, setAfficherTraitees] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState<typeof TOUS_STATUTS | StatutAnomalie>(TOUS_STATUTS);
  const [filtreType, setFiltreType] = useState('');

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
  }, [cabinetId, dossierId, periode]);

  const visibles = (
    variant === 'cycle'
      ? afficherTraitees
        ? anomalies
        : anomalies.filter((a) => a.statut === 'ouvert')
      : anomalies
          .filter((a) => filtreStatut === TOUS_STATUTS || a.statut === filtreStatut)
          .filter((a) => !filtreType.trim() || a.typeAnomalie.toLowerCase().includes(filtreType.trim().toLowerCase()))
  );
  const nbOuvertes = anomalies.filter((a) => a.statut === 'ouvert').length;

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
          <>
            <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value as StatutAnomalie)}>
              <option value={TOUS_STATUTS}>Tous les statuts</option>
              <option value="ouvert">Ouvertes</option>
              <option value="resolu">Résolues</option>
              <option value="justifie">Justifiées</option>
            </select>
            <input
              type="text"
              placeholder="Filtrer par type (ex : taux_incoherent)"
              value={filtreType}
              onChange={(e) => setFiltreType(e.target.value)}
            />
          </>
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
            utilisateurId={utilisateurId}
            onChanged={() => void charger()}
          />
        ))}
      </ul>
    </section>
  );
}
