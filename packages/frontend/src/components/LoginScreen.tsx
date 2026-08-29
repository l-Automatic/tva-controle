import { useState, type FormEvent } from 'react';
import { ApiError, login } from '../api';
import type { Session } from '../types';

interface LoginScreenProps {
  onConnecte: (session: Session) => void;
}

// Écran de connexion (brief v25) — remplace l'ancienne saisie manuelle du
// cabinet/utilisateur dans le volet latéral. 401 volontairement générique
// côté backend (jamais de distinction email inconnu / mot de passe
// incorrect) — l'interface ne recrée pas cette distinction non plus.
export function LoginScreen({ onConnecte }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnexion() {
    if (!email.trim() || !motDePasse) {
      setError('Email et mot de passe sont requis');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await login(email.trim(), motDePasse);
      onConnecte(session);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Identifiants invalides.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec de la connexion');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void handleConnexion();
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={40} height={40} className="sidebar-brand-logo" />
          <span>TVA Contrôle</span>
        </div>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            disabled={submitting}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
