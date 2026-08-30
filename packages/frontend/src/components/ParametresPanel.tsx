import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  ApiError,
  definirParametreCabinet,
  definirParametreDossier,
  fetchParametresCabinet,
  fetchParametresDossier,
  synchroniserDossiers,
} from '../api';
import { useToast } from '../toast';
import {
  CLE_PENNYLANE_FIRM_API_KEY,
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
  // Appelé après une synchronisation réussie (brief v27), pour que la
  // liste des dossiers affichée dans le volet latéral (Sidebar.tsx) se
  // rafraîchisse et montre les nouveaux dossiers immédiatement.
  onDossiersSynchronises?: () => void;
}

const CLE_MISTRAL = 'mistral_api_key';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR');
  } catch {
    return iso;
  }
}

// Un champ par clé secrète cabinet (clé Mistral, jeton API Cabinet
// Pennylane — brief v27) — jamais réaffichée en clair une fois enregistrée,
// le backend la masque déjà ('••••••••'), affichée telle quelle sans
// tentative de déchiffrement côté client.
function ChampSecretCabinet({
  cabinetId,
  utilisateurId,
  cle,
  libelle,
  placeholder,
  parametres,
  loading,
  onDefini,
}: {
  cabinetId: string;
  utilisateurId: string;
  cle: string;
  libelle: string;
  placeholder: string;
  parametres: Parametre[];
  loading: boolean;
  onDefini: () => void;
}) {
  const [nouvelleValeur, setNouvelleValeur] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  const parametre = parametres.find((p) => p.cle === cle);
  const valeurAffichee = parametre ? String(parametre.valeur) : null;

  async function handleDefinir() {
    if (!nouvelleValeur.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await definirParametreCabinet(cabinetId, utilisateurId, cle, nouvelleValeur.trim());
      setNouvelleValeur('');
      notifier(`${libelle} enregistrée`);
      onDefini();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la mise à jour');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="parametre-secret-cabinet">
      <p className="reference">
        {libelle} : <strong>{loading ? '…' : (valeurAffichee ?? 'Non définie')}</strong>
        {parametre && ` — dernière mise à jour ${formatDate(parametre.updatedAt)}`}
      </p>
      <div className="cycle-form">
        <label className="cycle-form-token">
          Nouvelle valeur
          <input
            type="password"
            placeholder={placeholder}
            value={nouvelleValeur}
            onChange={(e) => setNouvelleValeur(e.target.value)}
            disabled={submitting}
            autoComplete="off"
          />
        </label>
        <button onClick={() => void handleDefinir()} disabled={submitting || !nouvelleValeur.trim()}>
          {submitting ? '…' : parametre ? 'Redéfinir' : 'Définir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Auto-découverte des dossiers déjà gérés sous Pennylane (chantier API
// Cabinet, brief v27) — 400 si le jeton cabinet n'est pas encore
// configuré, message backend déjà clair sur quoi faire, affiché tel quel.
function SynchronisationDossiers({
  cabinetId,
  onSynchronise = () => {},
}: {
  cabinetId: string;
  onSynchronise?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [resume, setResume] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleSynchroniser() {
    setSubmitting(true);
    setError(null);
    setResume(null);
    try {
      const resultat = await synchroniserDossiers(cabinetId);
      const texte = `${resultat.total} dossier${resultat.total > 1 ? 's' : ''} synchronisé${resultat.total > 1 ? 's' : ''}, ${resultat.nouveaux} nouveau${resultat.nouveaux > 1 ? 'x' : ''}`;
      setResume(texte);
      notifier(texte);
      onSynchronise?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la synchronisation des dossiers');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="parametre-secret-cabinet">
      <p className="reference">
        Découvre automatiquement les dossiers déjà gérés sous Pennylane pour ce cabinet, à partir du jeton API
        Cabinet ci-dessus.
      </p>
      <button onClick={() => void handleSynchroniser()} disabled={submitting}>
        {submitting ? 'Synchronisation…' : 'Synchroniser les dossiers'}
      </button>
      {resume && <p className="reference">{resume}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CabinetSection({
  cabinetId,
  utilisateurId,
  onDossiersSynchronises = () => {},
}: {
  cabinetId: string;
  utilisateurId: string;
  onDossiersSynchronises?: () => void;
}) {
  const [parametres, setParametres] = useState<Parametre[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Paramètres cabinet</h2>
      </div>
      {error && <p className="error">{error}</p>}
      <ChampSecretCabinet
        cabinetId={cabinetId}
        utilisateurId={utilisateurId}
        cle={CLE_MISTRAL}
        libelle="Clé API Mistral"
        placeholder="Coller la nouvelle clé Mistral"
        parametres={parametres}
        loading={loading}
        onDefini={() => void charger()}
      />
      <p className="reference cycle-form-warning">
        Stockée en clair côté serveur pour l'instant (pas encore chiffrée).
      </p>
      <div className="panel-separateur" />
      <ChampSecretCabinet
        cabinetId={cabinetId}
        utilisateurId={utilisateurId}
        cle={CLE_PENNYLANE_FIRM_API_KEY}
        libelle="Jeton API Cabinet Pennylane"
        placeholder="Coller le jeton d'API Cabinet Pennylane"
        parametres={parametres}
        loading={loading}
        onDefini={() => void charger()}
      />
      <p className="reference cycle-form-warning">
        Remplace la saisie manuelle d'un token à chaque cycle — un seul jeton pour tout le cabinet, résolu
        automatiquement pour chaque dossier Pennylane.
      </p>
      <div className="panel-separateur" />
      <SynchronisationDossiers cabinetId={cabinetId} onSynchronise={onDossiersSynchronises} />
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
  onDossiersSynchronises = () => {},
}: ParametresPanelProps) {
  return (
    <>
      {role === 'admin_cabinet' && (
        <CabinetSection
          cabinetId={cabinetId}
          utilisateurId={utilisateurId}
          onDossiersSynchronises={onDossiersSynchronises}
        />
      )}
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
