import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  ApiError,
  corrigerNiveauConfianceTiers,
  fetchConventions,
  fetchTauxHistorique,
  fetchTauxHistoriqueTiers,
  fetchTiersReference,
  rejeterTauxHistorique,
  rejeterTauxHistoriqueTiers,
  retirerCompteConvention,
} from '../api';
import { useToast } from '../toast';
import {
  CLES_CONVENTIONS_COMPTES,
  LIBELLE_CLE_CONVENTION,
  type CleConventionCompte,
  type NiveauConfianceTiers,
  type Proposition,
  type TiersReference,
} from '../types';
import { Accordion } from './Accordion';

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
    <Accordion titre="Confiance des tiers" meta={<span className="reference">{tiers.length}</span>}>
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
    </Accordion>
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
    <Accordion titre="Conventions de comptes">
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
    </Accordion>
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
    <Accordion titre="Taux historique confirmés" meta={<span className="reference">{toutes.length}</span>}>
      {error && <p className="error">{error}</p>}
      {!loading && toutes.length === 0 && <p className="empty">Aucun taux confirmé pour l’instant.</p>}
      <ul className="card-list">
        {toutes.map(({ p, estTiers }) => (
          <li key={p.id} className="card proposition">
            <div className="card-header">
              <span className="badge badge-origine">{estTiers ? 'Compte client' : 'Compte de TVA collectée'}</span>
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
    </Accordion>
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
      <ConventionsComptesRetraitSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <TauxConfirmesSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
    </section>
  );
}
