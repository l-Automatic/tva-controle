import { useEffect, useState } from 'react';
import {
  ApiError,
  assignerTauxCompte,
  assignerTauxHistoriqueTiersManuel,
  fetchTauxAssignes,
  fetchTauxHistoriqueTiers,
} from '../../api';
import { formatDate } from '../../dateUtils';
import { useToast } from '../../toast';
import {
  LIBELLE_TAUX_ASSIGNE,
  VALEURS_TAUX_ASSIGNE,
  type Proposition,
  type TauxAssigne,
  type TauxAssigneEntry,
} from '../../types';

interface SectionProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

function TauxAssigneProduitChargeSection({ cabinetId, dossierId, utilisateurId }: SectionProps) {
  const [assignations, setAssignations] = useState<TauxAssigneEntry[]>([]);
  const [compte, setCompte] = useState('');
  const [taux, setTaux] = useState<TauxAssigne>('20');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      setAssignations(await fetchTauxAssignes(cabinetId, dossierId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les taux assignés');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleAssigner(compteCible: string, tauxCible: TauxAssigne) {
    if (!compteCible.trim()) {
      setError('Un numéro de compte est requis');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await assignerTauxCompte(cabinetId, dossierId, compteCible.trim(), tauxCible, utilisateurId);
      notifier('Taux assigné');
      setCompte('');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’assignation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h3>Produit/charge</h3>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && assignations.length === 0 && <p className="empty">Aucun taux assigné pour l’instant.</p>}
      <ul className="card-list">
        {assignations.map((a) => (
          <li key={a.compte} className="card">
            <p className="label">
              Compte {a.compte} : <strong>{LIBELLE_TAUX_ASSIGNE[a.tauxAssigne]}</strong>
            </p>
            <p className="reference">Mis à jour {formatDate(a.updatedAt)}</p>
            <div className="actions">
              <select
                defaultValue={a.tauxAssigne}
                disabled={submitting}
                onChange={(e) => void handleAssigner(a.compte, e.target.value as TauxAssigne)}
              >
                {VALEURS_TAUX_ASSIGNE.map((v) => (
                  <option key={v} value={v}>
                    {LIBELLE_TAUX_ASSIGNE[v]}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
      <div className="cycle-form">
        <label>
          Compte
          <input
            type="text"
            placeholder="ex : 706100"
            value={compte}
            onChange={(e) => setCompte(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Taux
          <select value={taux} onChange={(e) => setTaux(e.target.value as TauxAssigne)} disabled={submitting}>
            {VALEURS_TAUX_ASSIGNE.map((v) => (
              <option key={v} value={v}>
                {LIBELLE_TAUX_ASSIGNE[v]}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void handleAssigner(compte, taux)} disabled={submitting}>
          {submitting ? '…' : 'Assigner'}
        </button>
      </div>
    </div>
  );
}

function TauxAssigneClientSection({ cabinetId, dossierId, utilisateurId }: SectionProps) {
  const [assignations, setAssignations] = useState<Proposition[]>([]);
  const [numeroCompteTiers, setNumeroCompteTiers] = useState('');
  const [taux, setTaux] = useState('20');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      // Les taux confirmés incluent aussi bien la détection automatique
      // (candidate confirmée) que l'assignation manuelle — les deux sont la
      // même donnée côté base (taux_historique_tiers, statut='confirmed').
      setAssignations(await fetchTauxHistoriqueTiers(cabinetId, dossierId, 'confirmed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les taux assignés');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleAssigner(compteCible: string, tauxCible: string) {
    const valeur = Number.parseFloat(tauxCible);
    if (!compteCible.trim()) {
      setError('Un numéro de compte client est requis');
      return;
    }
    if (Number.isNaN(valeur) || valeur < 0 || valeur > 100) {
      setError('Le taux doit être un nombre entre 0 et 100');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await assignerTauxHistoriqueTiersManuel(cabinetId, dossierId, compteCible.trim(), valeur, utilisateurId);
      notifier('Taux client assigné');
      setNumeroCompteTiers('');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’assignation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h3>Client</h3>
      </div>
      <p className="reference">
        Assignation directe, distincte de la détection automatique sur historique lettré (onglet Taux historique) —
        utile si le taux habituel d’un client est déjà connu, sans attendre qu’un historique se constitue.
      </p>
      {error && <p className="error">{error}</p>}
      {!loading && assignations.length === 0 && <p className="empty">Aucun taux client assigné pour l’instant.</p>}
      <ul className="card-list">
        {assignations.map((a) => (
          <li key={a.id} className="card">
            <p className="label">
              Client {a.numeroCompteTiers} : <strong>{a.tauxHabituel}%</strong>
            </p>
            <p className="reference">{a.source === 'saisie_manuelle' ? 'Assigné manuellement' : a.source}</p>
          </li>
        ))}
      </ul>
      <div className="cycle-form">
        <label>
          Compte client
          <input
            type="text"
            placeholder="ex : 411800"
            value={numeroCompteTiers}
            onChange={(e) => setNumeroCompteTiers(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Taux (%)
          <input
            type="text"
            inputMode="decimal"
            placeholder="ex : 20"
            value={taux}
            onChange={(e) => setTaux(e.target.value)}
            disabled={submitting}
          />
        </label>
        <button onClick={() => void handleAssigner(numeroCompteTiers, taux)} disabled={submitting}>
          {submitting ? '…' : 'Assigner'}
        </button>
      </div>
    </div>
  );
}

// Attribue directement un taux de TVA à un compte ou un client, une fois
// pour toutes — pas de workflow candidate/confirmed, distinct de la
// détection automatique sur historique (onglet Taux historique). Demande
// explicite de Rami (09/08) : accessible directement dans Configuration du
// dossier, pas enterré dans Paramètres (cf. brief v3, section 4).
export function TauxAssigneZone({ cabinetId, dossierId, utilisateurId }: SectionProps) {
  return (
    <section className="panel panel-full">
      <TauxAssigneProduitChargeSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <div className="panel-separateur" />
      <TauxAssigneClientSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
    </section>
  );
}
