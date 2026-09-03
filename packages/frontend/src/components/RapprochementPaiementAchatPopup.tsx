import { useState } from 'react';
import { X } from 'lucide-react';
import { ApiError, enregistrerRapprochementPaiementAchat } from '../api';
import { formatDate } from '../dateUtils';
import { useToast } from '../toast';
import { formatMontant } from './CalculsPanel';
import type { ConfianceSuggestionIA, FactureARapprocher } from '../types';

interface RapprochementPaiementAchatPopupProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // periodeDebut du cycle en cours de préparation — clé de résolution
  // côté backend (cf. listerFacturesLedgerEntryIdsRapprochees), distincte
  // de la fenêtre de recherche des candidats (tout l'exercice comptable).
  periode: string;
  factures: FactureARapprocher[];
  onClose: () => void;
}

const LIBELLE_CONFIANCE: Record<ConfianceSuggestionIA, string> = {
  haute: 'Confiance haute',
  moyenne: 'Confiance moyenne',
  basse: 'Confiance basse',
};

function FactureCard({
  facture,
  cabinetId,
  dossierId,
  utilisateurId,
  periode,
  onTraite,
}: {
  facture: FactureARapprocher;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periode: string;
  onTraite: () => void;
}) {
  // Précochage IA (brief v34) : point de départ modifiable, jamais une
  // validation implicite — le collaborateur coche/décoche librement avant
  // de valider explicitement.
  const [coches, setCoches] = useState<Set<number>>(
    () => new Set(facture.candidats.filter((c) => c.precoche).map((c) => c.ledgerEntryId))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  function toggle(ledgerEntryId: number) {
    setCoches((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(ledgerEntryId)) suivant.delete(ledgerEntryId);
      else suivant.add(ledgerEntryId);
      return suivant;
    });
  }

  async function handleValider() {
    setSubmitting(true);
    setError(null);
    try {
      const paiementsValides = facture.candidats
        .filter((c) => coches.has(c.ledgerEntryId))
        .map((c) => ({ ledgerEntryId: c.ledgerEntryId, montant: c.montant }));
      await enregistrerRapprochementPaiementAchat(cabinetId, dossierId, {
        periode,
        factureLedgerEntryId: facture.ledgerEntryId,
        montantFactureTotal: facture.montantFactureTotal,
        paiementsValides,
        utilisateurId,
      });
      notifier(
        paiementsValides.length === 0
          ? 'Facture rapprochée — aucun paiement correspondant'
          : `Facture rapprochée — ${paiementsValides.length} paiement(s) validé(s)`
      );
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'enregistrement du rapprochement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="card">
      <p className="label">
        {facture.libelle ?? 'Facture sans libellé'} — <strong>{formatMontant(facture.montantFactureTotal)}</strong>
      </p>
      <p className="reference">
        {formatDate(facture.date)} — pièce {facture.ledgerEntryId}
      </p>
      {facture.candidats.length === 0 ? (
        <p className="empty">Aucun paiement candidat trouvé sur l'exercice.</p>
      ) : (
        <ul className="card-list">
          {facture.candidats.map((c) => (
            <li key={c.ledgerEntryId} className="card">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={coches.has(c.ledgerEntryId)}
                  onChange={() => toggle(c.ledgerEntryId)}
                  disabled={submitting}
                />
                {c.libelle ?? 'Paiement sans libellé'} — {formatMontant(c.montant)} ({formatDate(c.date)})
              </label>
              {c.confiance && <span className={`badge confiance-${c.confiance}`}>{LIBELLE_CONFIANCE[c.confiance]}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={() => void handleValider()} disabled={submitting}>
          {submitting ? '…' : 'Valider le rapprochement'}
        </button>
      </div>
    </li>
  );
}

// Remplace l'ancien mécanisme automatique (brief v34) — une facture de
// service non payée est présentée avec tous ses paiements candidats sur
// toute la fenêtre de l'exercice, précochés par l'IA quand fiable, jamais
// une décision finale prise par le LLM seul. Porte obligatoire avant un
// cycle, comme la catégorisation (CategorisationPopup) : fermer sans tout
// traiter est normal, les factures non traitées réapparaîtront au
// prochain essai de lancement de cycle.
export function RapprochementPaiementAchatPopup({
  cabinetId,
  dossierId,
  utilisateurId,
  periode,
  factures: facturesInitiales,
  onClose,
}: RapprochementPaiementAchatPopupProps) {
  const [factures, setFactures] = useState(facturesInitiales);

  function retirer(ledgerEntryId: number) {
    setFactures((prev) => prev.filter((f) => f.ledgerEntryId !== ledgerEntryId));
  }

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true" aria-label="Rapprochement des paiements achats">
      <div className="popup">
        <div className="popup-header">
          <h2>Rapprochement des paiements achats ({factures.length})</h2>
          <button className="popup-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <p className="reference">
          Factures de service non payées, avec leurs paiements candidats trouvés sur toute la fenêtre de l'exercice.
          Les cases précochées reflètent une suggestion IA quand disponible — à valider ou corriger avant d'envoyer.
        </p>
        {factures.length === 0 ? (
          <p className="empty">Toutes les factures ont été rapprochées.</p>
        ) : (
          <ul className="card-list">
            {factures.map((f) => (
              <FactureCard
                key={f.ledgerEntryId}
                facture={f}
                cabinetId={cabinetId}
                dossierId={dossierId}
                utilisateurId={utilisateurId}
                periode={periode}
                onTraite={() => retirer(f.ledgerEntryId)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
