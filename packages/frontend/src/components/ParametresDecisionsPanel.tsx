import { useEffect, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import {
  ApiError,
  assignerTauxCompte,
  corrigerNiveauConfianceTiers,
  fetchConventions,
  fetchTauxAssignes,
  fetchTauxHistorique,
  fetchTauxHistoriqueTiers,
  fetchTiersReference,
  rejeterTauxHistorique,
  rejeterTauxHistoriqueTiers,
  retirerCompteConvention,
} from '../api';
import { formatDate } from '../dateUtils';
import { useToast } from '../toast';
import {
  CLES_CONVENTIONS_COMPTES,
  LIBELLE_CLE_CONVENTION,
  LIBELLE_TAUX_ASSIGNE,
  VALEURS_TAUX_ASSIGNE,
  type CleConventionCompte,
  type NiveauConfianceTiers,
  type Proposition,
  type TauxAssigne,
  type TauxAssigneEntry,
  type TiersReference,
} from '../types';

interface SectionProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

const LIBELLE_NIVEAU_CONFIANCE: Record<NiveauConfianceTiers, string> = {
  nouveau: 'Nouveau',
  a_surveiller: 'À surveiller',
  confiance: 'Confiance',
};

function TiersConfianceSection({ cabinetId, dossierId, utilisateurId }: SectionProps) {
  const [tiers, setTiers] = useState<TiersReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      setTiers(await fetchTiersReference(cabinetId, dossierId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les tiers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleCorriger(numeroCompteTiers: string, niveau: NiveauConfianceTiers) {
    setCorrection(numeroCompteTiers);
    setError(null);
    try {
      await corrigerNiveauConfianceTiers(cabinetId, dossierId, numeroCompteTiers, niveau, utilisateurId);
      notifier('Niveau de confiance corrigé');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la correction');
    } finally {
      setCorrection(null);
    }
  }

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h3>Confiance des tiers</h3>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && tiers.length === 0 && <p className="empty">Aucun tiers suivi pour ce dossier.</p>}
      <ul className="card-list">
        {tiers.map((t) => (
          <li key={t.numeroCompteTiers} className="card">
            <div className="card-header">
              <span className={`badge niveau-confiance-${t.niveauConfiance}`}>
                {LIBELLE_NIVEAU_CONFIANCE[t.niveauConfiance]}
              </span>
              <span className="reference">{t.nbControlesSansAnomalie} cycle(s) sans anomalie</span>
            </div>
            <p className="label">
              {t.numeroCompteTiers}
              {t.nomTiers && ` — ${t.nomTiers}`}
            </p>
            <div className="actions">
              <select
                value={t.niveauConfiance}
                disabled={correction === t.numeroCompteTiers}
                onChange={(e) => void handleCorriger(t.numeroCompteTiers, e.target.value as NiveauConfianceTiers)}
              >
                {(Object.keys(LIBELLE_NIVEAU_CONFIANCE) as NiveauConfianceTiers[]).map((n) => (
                  <option key={n} value={n}>
                    {LIBELLE_NIVEAU_CONFIANCE[n]}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConventionsComptesRetraitSection({ cabinetId, dossierId, utilisateurId }: SectionProps) {
  const [conventions, setConventions] = useState<Proposition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrait, setRetrait] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchConventions(cabinetId, dossierId, 'confirmed');
      setConventions(data.filter((c) => CLES_CONVENTIONS_COMPTES.includes(c.cle as CleConventionCompte)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les conventions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleRetirer(cle: string, compte: string) {
    const cleId = `${cle}-${compte}`;
    setRetrait(cleId);
    setError(null);
    try {
      await retirerCompteConvention(cabinetId, dossierId, cle, compte, utilisateurId);
      notifier(`Compte ${compte} retiré`);
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du retrait');
    } finally {
      setRetrait(null);
    }
  }

  const tousVides = conventions.every((c) => !Array.isArray(c.valeur) || c.valeur.length === 0);

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h3>Conventions de comptes</h3>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && (conventions.length === 0 || tousVides) && (
        <p className="empty">Aucun compte confirmé pour l’instant.</p>
      )}
      <div className="conventions-comptes-grid">
        {conventions.map((c) => {
          const comptes = Array.isArray(c.valeur) ? (c.valeur as string[]) : [];
          if (comptes.length === 0) return null;
          return (
            <div key={c.id} className="convention-compte-groupe">
              <h3>{LIBELLE_CLE_CONVENTION[c.cle as CleConventionCompte] ?? c.cle}</h3>
              <ul className="chip-list">
                {comptes.map((compte) => (
                  <li key={compte} className="chip">
                    {compte}
                    <button
                      className="chip-remove"
                      disabled={retrait === `${c.cle}-${compte}`}
                      onClick={() => void handleRetirer(c.cle as string, compte)}
                      aria-label={`Retirer le compte ${compte}`}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TauxConfirmesSection({ cabinetId, dossierId, utilisateurId }: SectionProps) {
  const [comptes, setComptes] = useState<Proposition[]>([]);
  const [tiers, setTiers] = useState<Proposition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejet, setRejet] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const [dataComptes, dataTiers] = await Promise.all([
        fetchTauxHistorique(cabinetId, dossierId, 'confirmed'),
        fetchTauxHistoriqueTiers(cabinetId, dossierId, 'confirmed'),
      ]);
      setComptes(dataComptes);
      setTiers(dataTiers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les taux confirmés');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleRejeter(id: string, estTiers: boolean) {
    setRejet(id);
    setError(null);
    try {
      if (estTiers) await rejeterTauxHistoriqueTiers(cabinetId, id, utilisateurId);
      else await rejeterTauxHistorique(cabinetId, id, utilisateurId);
      notifier('Taux rejeté');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du rejet');
    } finally {
      setRejet(null);
    }
  }

  const toutes = [
    ...comptes.map((p) => ({ p, estTiers: false })),
    ...tiers.map((p) => ({ p, estTiers: true })),
  ];

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h3>Taux historique confirmés</h3>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && toutes.length === 0 && <p className="empty">Aucun taux confirmé pour l’instant.</p>}
      <ul className="card-list">
        {toutes.map(({ p, estTiers }) => (
          <li key={p.id} className="card proposition">
            <div className="card-header">
              <span className="badge badge-origine">{estTiers ? 'Compte client' : 'Compte produit/charge'}</span>
            </div>
            <p className="label">
              {estTiers ? p.numeroCompteTiers : p.compteProduitOuCharge} — taux habituel {p.tauxHabituel}%
            </p>
            <div className="actions">
              <button
                className="secondary"
                disabled={rejet === p.id}
                onClick={() => void handleRejeter(p.id, estTiers)}
              >
                {rejet === p.id ? '…' : 'Rejeter'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TauxAssigneSection({ cabinetId, dossierId, utilisateurId }: SectionProps) {
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
        <h3>Taux assigné par compte</h3>
      </div>
      <p className="reference">
        Assignation directe, pour un futur contrôle de cohérence de fin d’exercice (pas encore construit) — pas de
        candidate/confirmed, juste la valeur courante.
      </p>
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
              <Pencil size={14} aria-hidden="true" className="reference" />
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

// Vue et correction de toutes les décisions déjà validées sur ce dossier —
// distinct des écrans de traitement (Configuration/Cycle) qui ne montrent
// que ce qui est encore en attente (cf. brief v2, section 6).
export function ParametresDecisionsPanel({ cabinetId, dossierId, utilisateurId }: SectionProps) {
  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Décisions validées — vue et correction</h2>
      </div>
      <TiersConfianceSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <div className="panel-separateur" />
      <ConventionsComptesRetraitSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <div className="panel-separateur" />
      <TauxConfirmesSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <div className="panel-separateur" />
      <TauxAssigneSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
    </section>
  );
}
