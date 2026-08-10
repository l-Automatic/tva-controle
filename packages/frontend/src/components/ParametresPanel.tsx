import { useEffect, useState } from 'react';
import {
  ApiError,
  definirParametreCabinet,
  definirParametreDossier,
  fetchParametresCabinet,
  fetchParametresDossier,
} from '../api';
import { useToast } from '../toast';
import type { Parametre } from '../types';

interface ParametresPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

const CLE_MISTRAL = 'mistral_api_key';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR');
  } catch {
    return iso;
  }
}

function CabinetSection({ cabinetId, utilisateurId }: { cabinetId: string; utilisateurId: string }) {
  const [parametres, setParametres] = useState<Parametre[]>([]);
  const [nouvelleCle, setNouvelleCle] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchParametresCabinet(cabinetId);
      setParametres(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les paramètres du cabinet');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId]);

  async function handleDefinir() {
    if (!nouvelleCle.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await definirParametreCabinet(cabinetId, utilisateurId, CLE_MISTRAL, nouvelleCle.trim());
      setNouvelleCle('');
      notifier('Paramètre cabinet enregistré');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la mise à jour');
    } finally {
      setSubmitting(false);
    }
  }

  const mistral = parametres.find((p) => p.cle === CLE_MISTRAL);
  // La valeur est déjà masquée par l'API ('••••••••') si définie — affichée
  // telle quelle, jamais recalculée ni déchiffrée côté client.
  const valeurAffichee = mistral ? String(mistral.valeur) : null;

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Paramètres cabinet</h2>
      </div>
      <p className="reference">
        Clé API Mistral : <strong>{loading ? '…' : (valeurAffichee ?? 'Non définie')}</strong>
        {mistral && ` — dernière mise à jour ${formatDate(mistral.updatedAt)}`}
      </p>
      <div className="cycle-form">
        <label className="cycle-form-token">
          Nouvelle clé
          <input
            type="password"
            placeholder="Coller la nouvelle clé Mistral"
            value={nouvelleCle}
            onChange={(e) => setNouvelleCle(e.target.value)}
            disabled={submitting}
            autoComplete="off"
          />
        </label>
        <button onClick={() => void handleDefinir()} disabled={submitting || !nouvelleCle.trim()}>
          {submitting ? '…' : mistral ? 'Redéfinir' : 'Définir'}
        </button>
      </div>
      <p className="reference cycle-form-warning">
        Stockée en clair côté serveur pour l'instant (pas encore chiffrée).
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function DossierSection({
  cabinetId,
  dossierId,
  utilisateurId,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}) {
  const [parametres, setParametres] = useState<Parametre[]>([]);
  const [cle, setCle] = useState('');
  const [valeur, setValeur] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchParametresDossier(cabinetId, dossierId);
      setParametres(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les paramètres du dossier');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleDefinir() {
    if (!cle.trim()) {
      setError('Une clé est requise');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await definirParametreDossier(cabinetId, dossierId, utilisateurId, cle.trim(), valeur);
      setCle('');
      setValeur('');
      notifier('Paramètre dossier enregistré');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la mise à jour');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Paramètres dossier</h2>
      </div>
      <p className="reference">
        Aucun paramètre dossier n'est encore exploité par le backend — clé/valeur libres, pour préparer le terrain.
      </p>
      {!loading && parametres.length === 0 && <p className="empty">Aucun paramètre défini pour ce dossier.</p>}
      <ul className="card-list">
        {parametres.map((p) => (
          <li key={p.cle} className="card">
            <p className="label">
              {p.cle} : <strong>{String(p.valeur)}</strong>
            </p>
            <p className="reference">Mis à jour {formatDate(p.updatedAt)}</p>
          </li>
        ))}
      </ul>
      <div className="cycle-form">
        <label>
          Clé
          <input type="text" placeholder="ex : seuil_alerte" value={cle} onChange={(e) => setCle(e.target.value)} disabled={submitting} />
        </label>
        <label>
          Valeur
          <input type="text" value={valeur} onChange={(e) => setValeur(e.target.value)} disabled={submitting} />
        </label>
        <button onClick={() => void handleDefinir()} disabled={submitting}>
          {submitting ? '…' : 'Définir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Deux sous-sections distinctes et clairement séparées visuellement : les
// routes API sont déjà séparées (/parametres-cabinet vs
// /dossiers/:id/parametres), on garde cette séparation côté utilisateur —
// pas de mode admin/collaborateur pour l'instant, les deux restent
// accessibles sans distinction de rôle (cf. brief refonte, section 3).
export function ParametresPanel({ cabinetId, dossierId, utilisateurId }: ParametresPanelProps) {
  return (
    <>
      <CabinetSection cabinetId={cabinetId} utilisateurId={utilisateurId} />
      <DossierSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
    </>
  );
}
