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
  type CompteClientSansTauxAssigne,
  type CompteSansTauxAssigne,
  type Proposition,
  type TauxAssigne,
  type TauxAssigneEntry,
} from '../../types';

interface SectionProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

const TAUX_TIERS_SUGGERES = ['20', '10', '5.5', '2.1'];

// 'mixte' (brief v22, migration 011) : plusieurs taux légitimement
// appliqués sur ce client — transmis tel quel dans le body JSON, stocké
// comme NULL côté serveur (taux_historique_tiers.taux_habituel). Distinct
// des taux numériques du select côté suggestions/formulaire manuel.
function versTauxEnvoye(brut: string): number | 'mixte' {
  return brut === 'mixte' ? 'mixte' : Number.parseFloat(brut);
}

function SuggestionsProduitCharge({
  cabinetId,
  dossierId,
  utilisateurId,
  suggestions,
  onConsommee,
  onAssigne,
}: SectionProps & { suggestions: CompteSansTauxAssigne[]; onConsommee: (compte: string) => void; onAssigne: () => void }) {
  const [choix, setChoix] = useState<Record<string, TauxAssigne>>({});
  const [enCours, setEnCours] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleConfirmer(compte: string) {
    const taux = choix[compte] ?? '20';
    setEnCours(compte);
    setError(null);
    try {
      await assignerTauxCompte(cabinetId, dossierId, compte, taux, utilisateurId);
      notifier('Taux assigné');
      onConsommee(compte);
      onAssigne();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’assignation');
    } finally {
      setEnCours(null);
    }
  }

  if (suggestions.length === 0) return null;

  return (
    <div className="suggestions-taux">
      <p className="reference">
        Comptes mouvementés au dernier cycle sans taux assigné — choisissez un taux pour chacun, ou ignorez-les (ils
        réapparaîtront au prochain cycle).
      </p>
      <ul className="card-list">
        {suggestions.map((s) => (
          <li key={s.compte} className="card statut-carte-brouillon">
            <p className="label">Compte {s.compte}</p>
            {s.exemplesLibelle.length > 0 && <p className="reference">{s.exemplesLibelle.join(' · ')}</p>}
            <div className="actions">
              <select
                value={choix[s.compte] ?? '20'}
                disabled={enCours === s.compte}
                onChange={(e) => setChoix((prev) => ({ ...prev, [s.compte]: e.target.value as TauxAssigne }))}
              >
                {VALEURS_TAUX_ASSIGNE.map((v) => (
                  <option key={v} value={v}>
                    {LIBELLE_TAUX_ASSIGNE[v]}
                  </option>
                ))}
              </select>
              <button onClick={() => void handleConfirmer(s.compte)} disabled={enCours === s.compte}>
                {enCours === s.compte ? '…' : 'Assigner'}
              </button>
              <button className="secondary" onClick={() => onConsommee(s.compte)} disabled={enCours === s.compte}>
                Ignorer
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function TauxAssigneProduitChargeSection({
  cabinetId,
  dossierId,
  utilisateurId,
  suggestions,
  onSuggestionConsommee,
}: SectionProps & { suggestions: CompteSansTauxAssigne[]; onSuggestionConsommee: (compte: string) => void }) {
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
      <SuggestionsProduitCharge
        cabinetId={cabinetId}
        dossierId={dossierId}
        utilisateurId={utilisateurId}
        suggestions={suggestions}
        onConsommee={onSuggestionConsommee}
        onAssigne={() => void charger()}
      />
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

function SuggestionsClient({
  cabinetId,
  dossierId,
  utilisateurId,
  suggestions,
  onConsommee,
  onAssigne,
}: SectionProps & {
  suggestions: CompteClientSansTauxAssigne[];
  onConsommee: (numeroCompteTiers: string) => void;
  onAssigne: () => void;
}) {
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleConfirmer(numeroCompteTiers: string) {
    const taux = versTauxEnvoye(choix[numeroCompteTiers] ?? '20');
    setEnCours(numeroCompteTiers);
    setError(null);
    try {
      await assignerTauxHistoriqueTiersManuel(cabinetId, dossierId, numeroCompteTiers, taux, utilisateurId);
      notifier('Taux client assigné');
      onConsommee(numeroCompteTiers);
      onAssigne();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’assignation');
    } finally {
      setEnCours(null);
    }
  }

  if (suggestions.length === 0) return null;

  return (
    <div className="suggestions-taux">
      <p className="reference">
        Comptes clients mouvementés au dernier cycle sans taux connu — choisissez un taux pour chacun, ou ignorez-les
        (ils réapparaîtront au prochain cycle).
      </p>
      <ul className="card-list">
        {suggestions.map((s) => (
          <li key={s.numeroCompteTiers} className="card statut-carte-brouillon">
            <p className="label">
              Client {s.numeroCompteTiers}
              {s.nomTiers && ` — ${s.nomTiers}`}
            </p>
            <div className="actions">
              <select
                value={choix[s.numeroCompteTiers] ?? '20'}
                disabled={enCours === s.numeroCompteTiers}
                onChange={(e) => setChoix((prev) => ({ ...prev, [s.numeroCompteTiers]: e.target.value }))}
              >
                {TAUX_TIERS_SUGGERES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('.', ',')} %
                  </option>
                ))}
                <option value="mixte">Mixte (plusieurs taux)</option>
              </select>
              <button onClick={() => void handleConfirmer(s.numeroCompteTiers)} disabled={enCours === s.numeroCompteTiers}>
                {enCours === s.numeroCompteTiers ? '…' : 'Assigner'}
              </button>
              <button
                className="secondary"
                onClick={() => onConsommee(s.numeroCompteTiers)}
                disabled={enCours === s.numeroCompteTiers}
              >
                Ignorer
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function TauxAssigneClientSection({
  cabinetId,
  dossierId,
  utilisateurId,
  suggestions,
  onSuggestionConsommee,
}: SectionProps & { suggestions: CompteClientSansTauxAssigne[]; onSuggestionConsommee: (numeroCompteTiers: string) => void }) {
  const [assignations, setAssignations] = useState<Proposition[]>([]);
  const [numeroCompteTiers, setNumeroCompteTiers] = useState('');
  const [taux, setTaux] = useState('20');
  const [tauxMixte, setTauxMixte] = useState(false);
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

  async function handleAssigner(compteCible: string, tauxCible: string, mixte: boolean) {
    if (!compteCible.trim()) {
      setError('Un numéro de compte client est requis');
      return;
    }
    let valeur: number | 'mixte';
    if (mixte) {
      valeur = 'mixte';
    } else {
      valeur = Number.parseFloat(tauxCible);
      if (Number.isNaN(valeur) || valeur < 0 || valeur > 100) {
        setError('Le taux doit être un nombre entre 0 et 100 (ou cocher "Mixte")');
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      await assignerTauxHistoriqueTiersManuel(cabinetId, dossierId, compteCible.trim(), valeur, utilisateurId);
      notifier('Taux client assigné');
      setNumeroCompteTiers('');
      setTauxMixte(false);
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
      <SuggestionsClient
        cabinetId={cabinetId}
        dossierId={dossierId}
        utilisateurId={utilisateurId}
        suggestions={suggestions}
        onConsommee={onSuggestionConsommee}
        onAssigne={() => void charger()}
      />
      {error && <p className="error">{error}</p>}
      {!loading && assignations.length === 0 && <p className="empty">Aucun taux client assigné pour l’instant.</p>}
      <ul className="card-list">
        {assignations.map((a) => (
          <li key={a.id} className="card">
            <p className="label">
              Client {a.numeroCompteTiers} :{' '}
              <strong>{a.tauxHabituel !== undefined ? `${a.tauxHabituel}%` : 'Mixte'}</strong>
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
            disabled={submitting || tauxMixte}
          />
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={tauxMixte}
            onChange={(e) => setTauxMixte(e.target.checked)}
            disabled={submitting}
          />
          Mixte
        </label>
        <button onClick={() => void handleAssigner(numeroCompteTiers, taux, tauxMixte)} disabled={submitting}>
          {submitting ? '…' : 'Assigner'}
        </button>
      </div>
    </div>
  );
}

interface TauxAssigneZoneProps extends SectionProps {
  suggestionsComptes: CompteSansTauxAssigne[];
  suggestionsClients: CompteClientSansTauxAssigne[];
  onSuggestionCompteConsommee: (compte: string) => void;
  onSuggestionClientConsommee: (numeroCompteTiers: string) => void;
}

// Attribue directement un taux de TVA à un compte ou un client, une fois
// pour toutes — pas de workflow candidate/confirmed, distinct de la
// détection automatique sur historique (onglet Taux historique). Demande
// explicite de Rami (09/08) : accessible directement dans Configuration du
// dossier, pas enterré dans Paramètres (cf. brief v3, section 4). Les
// suggestions (brief v4, section 4) viennent du dernier cycle lancé — pas de
// GET dédié, cette donnée est transitoire, calculée à la volée par le
// pipeline et jamais persistée telle quelle.
export function TauxAssigneZone({
  cabinetId,
  dossierId,
  utilisateurId,
  suggestionsComptes,
  suggestionsClients,
  onSuggestionCompteConsommee,
  onSuggestionClientConsommee,
}: TauxAssigneZoneProps) {
  return (
    <section className="panel panel-full">
      <TauxAssigneProduitChargeSection
        cabinetId={cabinetId}
        dossierId={dossierId}
        utilisateurId={utilisateurId}
        suggestions={suggestionsComptes}
        onSuggestionConsommee={onSuggestionCompteConsommee}
      />
      <div className="panel-separateur" />
      <TauxAssigneClientSection
        cabinetId={cabinetId}
        dossierId={dossierId}
        utilisateurId={utilisateurId}
        suggestions={suggestionsClients}
        onSuggestionConsommee={onSuggestionClientConsommee}
      />
    </section>
  );
}
