import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import {
  ApiError,
  ajouterConvention,
  confirmerConvention,
  fetchConventions,
  rejeterConvention,
} from '../api';
import { ICONE_ACTION } from '../icons';
import { useToast } from '../toast';
import { CLES_CONVENTIONS_COMPTES, LIBELLE_CLE_CONVENTION, type CleConventionCompte, type Proposition } from '../types';
import { BadgeStatut } from './BadgeStatut';

interface ConventionsComptesPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

function libelleComptes(valeur: unknown): string {
  if (Array.isArray(valeur)) return valeur.join(', ');
  return String(valeur);
}

function ConventionRow({
  proposition,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  proposition: Proposition;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState<'confirmer' | 'rejeter' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleConfirmer() {
    setSubmitting('confirmer');
    setError(null);
    try {
      await confirmerConvention(cabinetId, proposition.id, utilisateurId);
      notifier('Convention confirmée');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la confirmation');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRejeter() {
    setSubmitting('rejeter');
    setError(null);
    try {
      await rejeterConvention(cabinetId, proposition.id, utilisateurId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du rejet');
    } finally {
      setSubmitting(null);
    }
  }

  const estCandidate = proposition.statut === 'candidate';

  return (
    <li className={`card proposition${proposition.statut === 'confirmed' ? ' compte-confirme' : ''}`}>
      <div className="card-header">
        <BadgeStatut
          statut={proposition.statut}
          libelle={proposition.statut === 'candidate' ? 'En attente' : proposition.statut === 'confirmed' ? 'Confirmée' : 'Rejetée'}
        />
        <span className="source">{proposition.source === 'saisie_manuelle' ? 'Saisie manuelle' : proposition.source}</span>
      </div>
      <p className="label">{libelleComptes(proposition.valeur)}</p>

      {estCandidate && (
        <div className="actions">
          <button onClick={handleConfirmer} disabled={submitting !== null}>
            <ICONE_ACTION.confirmer size={14} aria-hidden="true" />
            {submitting === 'confirmer' ? '…' : 'Confirmer'}
          </button>
          <button onClick={handleRejeter} disabled={submitting !== null} className="secondary">
            <ICONE_ACTION.rejeter size={14} aria-hidden="true" />
            {submitting === 'rejeter' ? '…' : 'Rejeter'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

function AjoutForm({
  cabinetId,
  dossierId,
  utilisateurId,
  onAjoute,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onAjoute: () => void;
}) {
  const [cle, setCle] = useState<CleConventionCompte>(CLES_CONVENTIONS_COMPTES[0]);
  const [comptesTexte, setComptesTexte] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAjouter() {
    const comptes = comptesTexte
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (comptes.length === 0) {
      setError('Indiquez au moins un numéro de compte');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ajouterConvention(cabinetId, dossierId, utilisateurId, cle, comptes);
      setComptesTexte('');
      onAjoute();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’ajout');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ajout-convention">
      <select value={cle} onChange={(e) => setCle(e.target.value as CleConventionCompte)}>
        {CLES_CONVENTIONS_COMPTES.map((c) => (
          <option key={c} value={c}>
            {LIBELLE_CLE_CONVENTION[c]}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Numéros de compte séparés par des virgules (ex : 706, 707)"
        value={comptesTexte}
        onChange={(e) => setComptesTexte(e.target.value)}
        disabled={submitting}
      />
      <button onClick={() => void handleAjouter()} disabled={submitting}>
        <Plus size={14} aria-hidden="true" />
        {submitting ? '…' : 'Ajouter'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function ConventionsComptesPanel({ cabinetId, dossierId, utilisateurId }: ConventionsComptesPanelProps) {
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afficherRejetees, setAfficherRejetees] = useState(false);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchConventions(cabinetId, dossierId);
      setPropositions(data.filter((p) => CLES_CONVENTIONS_COMPTES.includes(p.cle as CleConventionCompte)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les conventions de comptes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Conventions de comptes</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={afficherRejetees}
            onChange={(e) => setAfficherRejetees(e.target.checked)}
          />
          Afficher les rejetées
        </label>
        <button onClick={() => void charger()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" />
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <AjoutForm cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} onAjoute={() => void charger()} />

      <div className="conventions-comptes-grid">
        {CLES_CONVENTIONS_COMPTES.map((cle) => {
          const pourCetteCle = propositions
            .filter((p) => p.cle === cle)
            .filter((p) => afficherRejetees || p.statut !== 'rejected');
          return (
            <div key={cle} className="convention-compte-groupe">
              <h3>{LIBELLE_CLE_CONVENTION[cle]}</h3>
              {pourCetteCle.length === 0 ? (
                <p className="empty">Aucune valeur configurée.</p>
              ) : (
                <ul className="card-list">
                  {pourCetteCle.map((p) => (
                    <ConventionRow
                      key={p.id}
                      proposition={p}
                      cabinetId={cabinetId}
                      utilisateurId={utilisateurId}
                      onChanged={() => void charger()}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
