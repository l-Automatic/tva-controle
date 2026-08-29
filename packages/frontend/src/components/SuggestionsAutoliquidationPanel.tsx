import { useState } from 'react';
import { ApiError, ajouterConvention, confirmerConvention } from '../api';
import { useToast } from '../toast';
import { SuggestionIABlock } from './SuggestionIABlock';
import type { CompteACategoriser } from '../types';

const CLE_CHARGE_AUTOLIQUIDATION = 'comptes_charge_autoliquidation';
const CLE_CHARGE_AUTOLIQUIDATION_REJETEE = 'comptes_charge_autoliquidation_rejetee';

interface SuggestionsAutoliquidationPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  suggestions: CompteACategoriser[];
  onConsomme: (compte: string) => void;
}

function SuggestionRow({
  compte,
  cabinetId,
  dossierId,
  utilisateurId,
  onTraite,
}: {
  compte: CompteACategoriser;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onTraite: () => void;
}) {
  const [enCours, setEnCours] = useState<'confirmer' | 'refuser' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleConfirmer() {
    setEnCours('confirmer');
    setError(null);
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, CLE_CHARGE_AUTOLIQUIDATION, [
        compte.compte,
      ]);
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte.compte} ajouté aux comptes d'autoliquidation`);
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de l'ajout du compte ${compte.compte}`);
    } finally {
      setEnCours(null);
    }
  }

  // Même mécanisme que "Aucune de celles-là" dans le popup principal
  // (brief v20) : cette détection est recalculée en direct depuis les
  // écritures brutes à chaque cycle, sans mémoire — sans ce geste, un
  // compte refusé revient indéfiniment (cf. pipeline.ts,
  // comptesChargeAutoliquidationRejetee).
  async function handleRefuser() {
    setEnCours('refuser');
    setError(null);
    try {
      const { id } = await ajouterConvention(
        cabinetId,
        dossierId,
        utilisateurId,
        CLE_CHARGE_AUTOLIQUIDATION_REJETEE,
        [compte.compte]
      );
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte.compte} refusé — ne sera plus suggéré`);
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec du refus du compte ${compte.compte}`);
    } finally {
      setEnCours(null);
    }
  }

  return (
    <li className="card">
      <p className="label">Compte {compte.compte}</p>
      {compte.exemplesLibelle.length > 0 && <p className="reference">{compte.exemplesLibelle.join(' · ')}</p>}
      {compte.suggestionIA && <SuggestionIABlock suggestion={compte.suggestionIA} />}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button disabled={enCours !== null} onClick={() => void handleConfirmer()}>
          {enCours === 'confirmer' ? '…' : 'Confirmer'}
        </button>
        <button className="secondary" disabled={enCours !== null} onClick={() => void handleRefuser()}>
          {enCours === 'refuser' ? '…' : 'Refuser'}
        </button>
      </div>
    </li>
  );
}

// Suggestions IA (brief v10) pour le compte de charge dédié à
// l'autoliquidation — distinct du popup de catégorisation des comptes
// produit/charge : ici on complète une convention déjà partiellement
// identifiée (comptes_charge_service) avec sa sous-catégorie plus précise.
// N'apparaît que si le dernier cycle a produit des suggestions ; disparaît
// dès qu'un compte est confirmé, refusé (brief v21), ou qu'un nouveau
// cycle est lancé.
export function SuggestionsAutoliquidationPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  suggestions,
  onConsomme,
}: SuggestionsAutoliquidationPanelProps) {
  if (suggestions.length === 0) return null;

  return (
    <section className="panel-section">
      <div className="panel-header">
        <h2>Comptes d'autoliquidation suggérés ({suggestions.length})</h2>
      </div>
      <p className="reference">
        Détectés parmi les comptes de charge de service sans sous-catégorie d'autoliquidation — confirmez pour les
        ajouter à la convention <code>comptes_charge_autoliquidation</code>, ou refusez si la suggestion ne
        convient pas (le compte ne sera plus proposé ici).
      </p>
      <ul className="card-list">
        {suggestions.map((c) => (
          <SuggestionRow
            key={c.compte}
            compte={c}
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            onTraite={() => onConsomme(c.compte)}
          />
        ))}
      </ul>
    </section>
  );
}
