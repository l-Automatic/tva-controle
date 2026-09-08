import { useState } from 'react';
import { ApiError, ajouterConvention, confirmerConvention, fetchComptesTvaAConfirmer } from '../api';
import { useToast } from '../toast';
import type { CompteTvaAConfirmer } from '../types';

interface ComptesTvaAConfirmerPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // Popup unique des portes obligatoires (brief v58) : évite un second
  // aller-retour réseau quand la période et les comptes ont déjà été
  // récupérés par GET /portes-obligatoires — la période est pré-remplie et
  // les résultats affichés immédiatement, mais reste modifiable via le
  // formulaire habituel (bouton "Vérifier") si besoin. Absent = comportement
  // inchangé pour l'usage autonome (Configuration du dossier).
  donneesInitiales?: { periodeDebut: string; periodeFin: string; comptes: CompteTvaAConfirmer[] };
}

// Quatrième porte obligatoire avant un cycle (brief v46) — même principe
// que la catégorisation et le parc de véhicules : un écran dédié,
// consultable à tout moment, pas seulement en réaction au 409 du
// lancement de cycle. Un compte 445xx mouvementé mais jamais confirmé
// dans l'un de ces quatre rôles bloque désormais le cycle.
const CHOIX = [
  { cle: 'compte_tva_due_autoliquidee', libelle: 'Compte TVA due autoliquidée (BTP)' },
  { cle: 'compte_tva_deductible_autoliquidee', libelle: 'Compte TVA déductible autoliquidée (BTP)' },
  { cle: 'compte_tva_due_autoliquidee_intracom', libelle: 'Compte TVA due autoliquidée (intracom)' },
  { cle: 'compte_tva_deductible_autoliquidee_intracom', libelle: 'Compte TVA déductible autoliquidée (intracom)' },
] as const;

function CompteCard({
  compte,
  cabinetId,
  dossierId,
  utilisateurId,
  onTraite,
}: {
  compte: CompteTvaAConfirmer;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onTraite: () => void;
}) {
  const [cle, setCle] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  // Valeur scalaire (le numéro de compte directement), contrairement aux
  // conventions de catégorisation qui sont des listes — ces quatre clés
  // n'ont chacune qu'un seul compte à la fois (cf. conventionValeur côté
  // backend, lecture d'une valeur unique, pas conventionListe).
  async function handleConfirmer() {
    if (!cle) return;
    setEnCours(true);
    setError(null);
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, cle, compte.compte);
      await confirmerConvention(cabinetId, id, utilisateurId);
      const libelle = CHOIX.find((c) => c.cle === cle)?.libelle ?? cle;
      notifier(`Compte ${compte.compte} confirmé : ${libelle}`);
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de la confirmation du compte ${compte.compte}`);
    } finally {
      setEnCours(false);
    }
  }

  const exemplesLibelle = compte.details?.exemplesLibelle ?? [];

  return (
    <li className="card">
      <p className="label">Compte {compte.compte}</p>
      <p className="description">{compte.description}</p>
      {exemplesLibelle.length > 0 && <p className="reference">{exemplesLibelle.join(' · ')}</p>}
      {error && <p className="error">{error}</p>}
      <div className="popup-choix">
        <select value={cle} disabled={enCours} onChange={(e) => setCle(e.target.value)}>
          <option value="">Choisir un rôle…</option>
          {CHOIX.map((c) => (
            <option key={c.cle} value={c.cle}>
              {c.libelle}
            </option>
          ))}
        </select>
        <button disabled={enCours || !cle} onClick={() => void handleConfirmer()}>
          {enCours ? '…' : 'Confirmer'}
        </button>
      </div>
    </li>
  );
}

export function ComptesTvaAConfirmerPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  donneesInitiales,
}: ComptesTvaAConfirmerPanelProps) {
  const [periodeDebut, setPeriodeDebut] = useState(donneesInitiales?.periodeDebut ?? '');
  const [periodeFin, setPeriodeFin] = useState(donneesInitiales?.periodeFin ?? '');
  const [comptes, setComptes] = useState<CompteTvaAConfirmer[] | null>(donneesInitiales?.comptes ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charger() {
    if (!periodeDebut || !periodeFin) {
      setError('Période de début et période de fin sont requises');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setComptes(await fetchComptesTvaAConfirmer(cabinetId, dossierId, periodeDebut, periodeFin));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les comptes TVA à confirmer');
    } finally {
      setLoading(false);
    }
  }

  function retirer(compte: string) {
    setComptes((prev) => prev?.filter((c) => c.compte !== compte) ?? null);
  }

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Comptes TVA à confirmer{comptes ? ` (${comptes.length})` : ''}</h2>
      </div>
      <p className="reference">
        Comptes de la famille TVA (445xx) avec du mouvement sur la période mais jamais confirmés (dû/déductible,
        BTP ou intracom). Bloque le lancement d'un cycle tant qu'ils ne sont pas tous confirmés.
      </p>
      <div className="cycle-form">
        <label>
          Période de début
          <input
            type="date"
            value={periodeDebut}
            onChange={(e) => setPeriodeDebut(e.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          Période de fin
          <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} disabled={loading} />
        </label>
        <button onClick={() => void charger()} disabled={loading}>
          {loading ? 'Chargement…' : 'Vérifier'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {comptes && comptes.length === 0 && (
        <p className="empty">Tous les comptes TVA sont confirmés pour cette période.</p>
      )}
      {comptes && comptes.length > 0 && (
        <ul className="card-list">
          {comptes.map((c) => (
            <CompteCard
              key={c.compte}
              compte={c}
              cabinetId={cabinetId}
              dossierId={dossierId}
              utilisateurId={utilisateurId}
              onTraite={() => retirer(c.compte)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
