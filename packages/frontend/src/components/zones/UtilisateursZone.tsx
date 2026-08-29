import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, creerUtilisateur, fetchUtilisateurs, redefinirMotDePasse } from '../../api';
import { useToast } from '../../toast';
import { LIBELLE_ROLE, type Role, type UtilisateurCabinet } from '../../types';

interface UtilisateursZoneProps {
  cabinetId: string;
}

const MOT_DE_PASSE_MIN = 8;

function ReinitialiserMotDePasseForm({
  cabinetId,
  utilisateurId,
  onTermine,
}: {
  cabinetId: string;
  utilisateurId: string;
  onTermine: () => void;
}) {
  const [motDePasse, setMotDePasse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleEnregistrer() {
    if (motDePasse.length < MOT_DE_PASSE_MIN) {
      setError(`Au moins ${MOT_DE_PASSE_MIN} caractères requis`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await redefinirMotDePasse(cabinetId, utilisateurId, motDePasse);
      notifier('Mot de passe réinitialisé');
      onTermine();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la réinitialisation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cycle-form">
      <label>
        Nouveau mot de passe
        <input
          type="password"
          placeholder={`Au moins ${MOT_DE_PASSE_MIN} caractères`}
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          disabled={submitting}
          autoComplete="new-password"
        />
      </label>
      <button onClick={() => void handleEnregistrer()} disabled={submitting}>
        {submitting ? '…' : 'Enregistrer'}
      </button>
      <button className="secondary" onClick={onTermine} disabled={submitting}>
        Annuler
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function UtilisateurRow({
  cabinetId,
  utilisateur,
}: {
  cabinetId: string;
  utilisateur: UtilisateurCabinet;
}) {
  const [reinitOuvert, setReinitOuvert] = useState(false);

  return (
    <li className="card">
      <p className="label">
        {utilisateur.nom} — <strong>{LIBELLE_ROLE[utilisateur.role]}</strong>
      </p>
      <p className="reference">{utilisateur.email}</p>
      {!utilisateur.aUnMotDePasse && (
        <p className="empty">N'a jamais pu se connecter — aucun mot de passe défini.</p>
      )}
      {reinitOuvert ? (
        <ReinitialiserMotDePasseForm
          cabinetId={cabinetId}
          utilisateurId={utilisateur.id}
          onTermine={() => setReinitOuvert(false)}
        />
      ) : (
        <div className="actions">
          <button className="secondary" onClick={() => setReinitOuvert(true)}>
            Réinitialiser le mot de passe
          </button>
        </div>
      )}
    </li>
  );
}

function AjoutUtilisateurForm({ cabinetId, onAjoute }: { cabinetId: string; onAjoute: () => void }) {
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('collaborateur');
  const [motDePasse, setMotDePasse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleAjouter() {
    if (!nom.trim() || !email.trim()) {
      setError('Nom et email sont requis');
      return;
    }
    if (motDePasse.length < MOT_DE_PASSE_MIN) {
      setError(`Mot de passe : au moins ${MOT_DE_PASSE_MIN} caractères`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await creerUtilisateur(cabinetId, { nom: nom.trim(), email: email.trim(), role, motDePasse });
      notifier('Utilisateur créé');
      setNom('');
      setEmail('');
      setMotDePasse('');
      setRole('collaborateur');
      onAjoute();
    } catch (err) {
      // 409 (email déjà utilisé) porte déjà un message clair côté backend
      // (cf. app.ts, EmailDejaUtiliseError) — affiché tel quel.
      setError(err instanceof ApiError ? err.message : "Échec de la création de l'utilisateur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cycle-form">
      <label>
        Nom
        <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          autoComplete="off"
        />
      </label>
      <label>
        Rôle
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={submitting}>
          <option value="collaborateur">{LIBELLE_ROLE.collaborateur}</option>
          <option value="admin_cabinet">{LIBELLE_ROLE.admin_cabinet}</option>
        </select>
      </label>
      <label>
        Mot de passe initial
        <input
          type="password"
          placeholder={`Au moins ${MOT_DE_PASSE_MIN} caractères`}
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          disabled={submitting}
          autoComplete="new-password"
        />
      </label>
      <button onClick={() => void handleAjouter()} disabled={submitting}>
        <Plus size={14} aria-hidden="true" />
        {submitting ? '…' : 'Ajouter'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Gestion des utilisateurs (brief v25) — visible seulement pour
// admin_cabinet, masqué entièrement pour un collaborateur (côté App.tsx/
// Sidebar.tsx, pas juste désactivé ici) : la route GET/POST /utilisateurs
// répond de toute façon 403 à un collaborateur, mais l'écran ne doit même
// pas être atteignable.
export function UtilisateursZone({ cabinetId }: UtilisateursZoneProps) {
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurCabinet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      setUtilisateurs(await fetchUtilisateurs(cabinetId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les utilisateurs');
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
        <h2>Utilisateurs ({utilisateurs.length})</h2>
      </div>
      <AjoutUtilisateurForm cabinetId={cabinetId} onAjoute={() => void charger()} />
      {error && <p className="error">{error}</p>}
      {!loading && utilisateurs.length === 0 && <p className="empty">Aucun utilisateur pour ce cabinet.</p>}
      <ul className="card-list">
        {utilisateurs.map((u) => (
          <UtilisateurRow key={u.id} cabinetId={cabinetId} utilisateur={u} />
        ))}
      </ul>
    </section>
  );
}
