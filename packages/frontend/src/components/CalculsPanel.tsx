import { useEffect, useState } from 'react';
import { ApiError, fetchCalculs, rejeterCalcul, validerCalcul } from '../api';
import { formatDate } from '../dateUtils';
import { useToast } from '../toast';
import type { Calcul, StatutCalcul } from '../types';

interface CalculsPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

export const LIBELLE_STATUT_CALCUL: Record<StatutCalcul, string> = {
  brouillon: 'Brouillon',
  valide: 'Validé',
  declare: 'Déclaré',
  rejete: 'Rejeté',
};

export function formatMontant(montant: number): string {
  return `${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
}

export function CalculRow({
  calcul,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  calcul: Calcul;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [motif, setMotif] = useState('');
  const [submitting, setSubmitting] = useState<'valider' | 'rejeter' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflit, setConflit] = useState(false);
  const notifier = useToast();

  async function handleValider() {
    if (
      !window.confirm(
        'Valider ce calcul ? Cette action est définitive : plus aucune modification ne sera possible ensuite (immuabilité).'
      )
    ) {
      return;
    }
    setSubmitting('valider');
    setError(null);
    setConflit(false);
    try {
      await validerCalcul(cabinetId, calcul.id, utilisateurId);
      notifier('Calcul validé');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec de la validation');
      }
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRejeter() {
    if (!motif.trim()) {
      setError('Un motif est requis pour rejeter un calcul');
      return;
    }
    if (!window.confirm('Rejeter ce calcul ? Il redeviendra un brouillon éditable si un cycle est relancé sur la même période.')) {
      return;
    }
    setSubmitting('rejeter');
    setError(null);
    setConflit(false);
    try {
      await rejeterCalcul(cabinetId, calcul.id, utilisateurId, motif.trim());
      notifier('Calcul rejeté');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec du rejet');
      }
    } finally {
      setSubmitting(null);
    }
  }

  const estBrouillon = calcul.statut === 'brouillon';

  return (
    <li className={`card calcul statut-carte-${calcul.statut}`}>
      <div className="card-header">
        <span className={`badge statut-${calcul.statut}`}>{LIBELLE_STATUT_CALCUL[calcul.statut]}</span>
        <span className="periode">
          {formatDate(calcul.periodeDebut)} — {formatDate(calcul.periodeFin)}
        </span>
      </div>
      <p className="label">
        {calcul.sens === 'a_decaisser' ? 'TVA à décaisser' : 'Crédit de TVA'} :{' '}
        <strong>{formatMontant(calcul.tvaNette)}</strong>
      </p>

      {estBrouillon ? (
        <div className="actions">
          <input
            type="text"
            placeholder="Motif (requis pour rejeter)"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            disabled={submitting !== null}
          />
          <button onClick={() => void handleValider()} disabled={submitting !== null}>
            {submitting === 'valider' ? '…' : 'Valider'}
          </button>
          <button onClick={() => void handleRejeter()} disabled={submitting !== null} className="secondary">
            {submitting === 'rejeter' ? '…' : 'Rejeter'}
          </button>
        </div>
      ) : calcul.statut === 'rejete' ? (
        <p className="reference">Rejeté — redeviendra brouillon si un cycle est relancé sur cette période.</p>
      ) : (
        <p className="reference">Immuable — plus aucune modification possible après validation.</p>
      )}
      {error && <p className={conflit ? 'error error-409' : 'error'}>{error}</p>}
    </li>
  );
}

export function CalculsPanel({ cabinetId, dossierId, utilisateurId }: CalculsPanelProps) {
  const [calculs, setCalculs] = useState<Calcul[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCalculs(cabinetId, dossierId);
      setCalculs(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les calculs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  const nbBrouillons = calculs.filter((c) => c.statut === 'brouillon').length;

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>
          Calculs ({nbBrouillons} brouillon{nbBrouillons === 1 ? '' : 's'} à valider)
        </h2>
        <button onClick={() => void charger()} disabled={loading}>
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && calculs.length === 0 && <p className="empty">Aucun calcul pour ce dossier.</p>}
      <ul className="card-list">
        {calculs.map((c) => (
          <CalculRow
            key={c.id}
            calcul={c}
            cabinetId={cabinetId}
            utilisateurId={utilisateurId}
            onChanged={() => void charger()}
          />
        ))}
      </ul>
    </section>
  );
}
