import { useState } from 'react';
import { X } from 'lucide-react';
import { ApiError, enregistrerRapprochementPaiementAchat, fetchRapprochementsPaiementAchat } from '../api';
import { formatDate } from '../dateUtils';
import { useToast } from '../toast';
import { formatMontant } from './CalculsPanel';
import type { ConfianceSuggestionIA, FactureARapprocher } from '../types';

interface RapprochementPaiementAchatPopupProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // periodeDebut du cycle en cours de préparation — clé de résolution
  // côté backend (cf. listerFacturesLedgerEntryIdsRapprochees) et borne
  // basse de la requête de rechargement (brief v35) ; periodeFin sert
  // uniquement à ce rechargement, distinctes de la fenêtre de recherche
  // des candidats (tout l'exercice comptable).
  periodeDebut: string;
  periodeFin: string;
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
  periodeDebut,
  onTraite,
}: {
  facture: FactureARapprocher;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periodeDebut: string;
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
        periode: periodeDebut,
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
      {/* Ordre demandé (brief v35) : compte fournisseur, libellé du
          compte, date de la facture, libellé de l'écriture, montant TTC —
          identifier immédiatement de quoi il s'agit sans avoir à déduire
          l'information. */}
      <p className="label">
        {facture.compteFournisseur}
        {facture.libelleCompteFournisseur && ` — ${facture.libelleCompteFournisseur}`}
      </p>
      <p className="reference">
        {formatDate(facture.date)} — {facture.libelle ?? 'Facture sans libellé'} — pièce {facture.ledgerEntryId}
      </p>
      <p className="label">
        Montant TTC : <strong>{formatMontant(facture.montantFactureTotal)}</strong>
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
//
// Déjà triée côté backend par compte fournisseur puis par date (brief
// v35) — jamais re-triée ici. Les factures sans aucun candidat sont
// désormais résolues automatiquement côté backend, absentes de la liste.
export function RapprochementPaiementAchatPopup({
  cabinetId,
  dossierId,
  utilisateurId,
  periodeDebut,
  periodeFin,
  factures: facturesInitiales,
  onClose,
}: RapprochementPaiementAchatPopupProps) {
  const [factures, setFactures] = useState(facturesInitiales);
  const [rechargement, setRechargement] = useState(false);

  // Un paiement validé pour une facture doit disparaître des candidats
  // des autres (brief v35, le backend exclut désormais automatiquement
  // les paiements déjà validés ailleurs) — un simple retrait local de la
  // facture traitée ne suffit plus, il faut recharger depuis le serveur
  // avant d'afficher la suite de la liste.
  async function recharger() {
    setRechargement(true);
    try {
      setFactures(await fetchRapprochementsPaiementAchat(cabinetId, dossierId, periodeDebut, periodeFin));
    } catch {
      // Silencieux : la facture qui vient d'être validée a déjà disparu
      // de son propre point de vue (toast de confirmation affiché) — un
      // échec de rechargement n'empêche pas de continuer, "Rafraîchir"
      // au prochain essai de lancement de cycle reste possible.
    } finally {
      setRechargement(false);
    }
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
        {rechargement && <p className="empty">Actualisation…</p>}
        {!rechargement && factures.length === 0 ? (
          <p className="empty">Toutes les factures ont été rapprochées.</p>
        ) : (
          !rechargement && (
            <ul className="card-list">
              {factures.map((f) => (
                <FactureCard
                  key={f.ledgerEntryId}
                  facture={f}
                  cabinetId={cabinetId}
                  dossierId={dossierId}
                  utilisateurId={utilisateurId}
                  periodeDebut={periodeDebut}
                  onTraite={() => void recharger()}
                />
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
