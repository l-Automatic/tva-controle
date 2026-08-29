import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  ApiError,
  definirParametreCabinet,
  definirParametreDossier,
  fetchParametresCabinet,
  fetchParametresDossier,
} from '../api';
import { useToast } from '../toast';
import {
  CLE_REGIME_TVA_ENCAISSEMENT,
  CLE_THEME_DEGRADE,
  DEGRADES_SIDEBAR,
  LIBELLE_REGIME_TVA_ENCAISSEMENT,
  VALEURS_REGIME_TVA_ENCAISSEMENT,
  type Parametre,
  type RegimeTvaEncaissement,
  type Role,
} from '../types';
import { ParametresDecisionsPanel } from './ParametresDecisionsPanel';

interface ParametresPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  role: Role;
  degradeActif: string;
  onDegradeChange: (degrade: string) => void;
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

function DegradeSection({
  cabinetId,
  dossierId,
  utilisateurId,
  degradeActif,
  onDegradeChange,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  degradeActif: string;
  onDegradeChange: (degrade: string) => void;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleChoisir(degrade: string) {
    setSubmitting(degrade);
    setError(null);
    try {
      await definirParametreDossier(cabinetId, dossierId, utilisateurId, CLE_THEME_DEGRADE, degrade);
      onDegradeChange(degrade);
      notifier('Dégradé du volet mis à jour');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la mise à jour');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Apparence</h2>
      </div>
      <p className="reference">
        Dégradé du volet latéral pour ce dossier — sert aussi de couleur secondaire pour les boutons principaux et
        les badges actifs.
      </p>
      <div className="degrade-grille">
        {DEGRADES_SIDEBAR.map((degrade) => (
          <button
            key={degrade}
            className={`degrade-swatch${degrade === degradeActif ? ' actif' : ''}`}
            style={{ background: degrade }}
            disabled={submitting !== null}
            onClick={() => void handleChoisir(degrade)}
            aria-label="Choisir ce dégradé"
          >
            {degrade === degradeActif && <Check size={16} color="#fff" aria-hidden="true" />}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function RegimeTvaSection({
  cabinetId,
  dossierId,
  utilisateurId,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}) {
  const [valeur, setValeur] = useState<RegimeTvaEncaissement | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchParametresDossier(cabinetId, dossierId);
      const param = data.find((p) => p.cle === CLE_REGIME_TVA_ENCAISSEMENT);
      setValeur(typeof param?.valeur === 'string' ? (param.valeur as RegimeTvaEncaissement) : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger le régime TVA');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleChanger(nouvelleValeur: RegimeTvaEncaissement) {
    setSubmitting(true);
    setError(null);
    try {
      await definirParametreDossier(cabinetId, dossierId, utilisateurId, CLE_REGIME_TVA_ENCAISSEMENT, nouvelleValeur);
      setValeur(nouvelleValeur);
      notifier('Régime TVA sur encaissement mis à jour');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la mise à jour');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Régime TVA sur encaissement</h2>
      </div>
      {error && <p className="error">{error}</p>}
      <select
        value={valeur ?? ''}
        disabled={loading || submitting}
        onChange={(e) => void handleChanger(e.target.value as RegimeTvaEncaissement)}
      >
        <option value="" disabled>
          {loading ? 'Chargement…' : 'Choisir…'}
        </option>
        {VALEURS_REGIME_TVA_ENCAISSEMENT.map((v) => (
          <option key={v} value={v}>
            {LIBELLE_REGIME_TVA_ENCAISSEMENT[v]}
          </option>
        ))}
      </select>
      <p className="reference cycle-form-warning">
        Détermine si un encaissement client sans facture rapprochée doit générer de la TVA collectée par défaut. Un
        commerce avec caisse ou vente comptant doit choisir « biens ».
      </p>
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
        Clé/valeur libres, pour préparer le terrain — aucun paramètre ici n'est encore exploité par un contrôle.
      </p>
      {(() => {
        const visibles = parametres.filter(
          (p) => p.cle !== CLE_THEME_DEGRADE && p.cle !== CLE_REGIME_TVA_ENCAISSEMENT
        );
        return (
          <>
            {!loading && visibles.length === 0 && <p className="empty">Aucun paramètre défini pour ce dossier.</p>}
            <ul className="card-list">
              {visibles.map((p) => (
                <li key={p.cle} className="card">
                  <p className="label">
                    {p.cle} : <strong>{String(p.valeur)}</strong>
                  </p>
                  <p className="reference">Mis à jour {formatDate(p.updatedAt)}</p>
                </li>
              ))}
            </ul>
          </>
        );
      })()}
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
// /dossiers/:id/parametres). Depuis le brief v25, /parametres-cabinet
// répond 403 à un collaborateur côté backend — CabinetSection est donc
// masquée ENTIÈREMENT pour ce rôle, pas juste désactivée ; le reste
// (paramètres dossier) reste accessible aux deux rôles, cf. brief refonte
// section 3 pour ce choix d'origine.
export function ParametresPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  role,
  degradeActif,
  onDegradeChange,
}: ParametresPanelProps) {
  return (
    <>
      {role === 'admin_cabinet' && <CabinetSection cabinetId={cabinetId} utilisateurId={utilisateurId} />}
      <DossierSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <RegimeTvaSection cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <DegradeSection
        cabinetId={cabinetId}
        dossierId={dossierId}
        utilisateurId={utilisateurId}
        degradeActif={degradeActif}
        onDegradeChange={onDegradeChange}
      />
      <ParametresDecisionsPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
    </>
  );
}
