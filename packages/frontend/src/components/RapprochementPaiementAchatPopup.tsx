import { useEffect, useState } from 'react';
import { ApiError, enregistrerRapprochementPaiementAchat } from '../api';
import { formatDate } from '../dateUtils';
import { useToast } from '../toast';
import { formatMontant } from './CalculsPanel';
import type { ConfianceSuggestionIA, FactureARapprocher } from '../types';

interface RapprochementPaiementAchatContenuProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // periodeDebut du cycle en cours de préparation — clé de résolution côté
  // backend (cf. listerFacturesLedgerEntryIdsRapprochees).
  periodeDebut: string;
  factures: FactureARapprocher[];
  // Brief v70, point 1 : badge de l'onglet côté PortesObligatoiresPopup,
  // sourcé jusqu'ici depuis l'instantané initial de l'agrégateur — remonte
  // désormais le compte réel de factures restantes dès qu'il varie
  // localement (validation), sans attendre un rechargement complet.
  onCountChange?: (n: number) => void;
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
  onTraite: (ledgerEntryIdsClaims: number[]) => void;
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
          ? 'Facture rapprochée, aucun paiement correspondant'
          : `Facture rapprochée, ${paiementsValides.length} paiement(s) validé(s)`
      );
      onTraite(paiementsValides.map((p) => p.ledgerEntryId));
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
        {facture.libelleCompteFournisseur && ` (${facture.libelleCompteFournisseur})`}
      </p>
      <p className="reference">
        {formatDate(facture.date)}, {facture.libelle ?? 'Facture sans libellé'} (pièce {facture.ledgerEntryId})
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
                {c.libelle ?? 'Paiement sans libellé'}, {formatMontant(c.montant)} ({formatDate(c.date)})
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

// Contenu seul, sans l'enveloppe popup — onglet du popup unique des portes
// obligatoires (brief v58, remplace l'ancienne popup dédiée dont c'était
// jusqu'ici le seul appelant). Une facture de service non payée est
// présentée avec tous ses paiements candidats sur toute la fenêtre de
// l'exercice, précochés par l'IA quand fiable, jamais une décision finale
// prise par le LLM seul. Fermer sans tout traiter est normal, les factures
// non traitées réapparaîtront au prochain essai de lancement de cycle.
//
// Déjà triée côté backend par compte fournisseur puis par date (brief
// v35) — jamais re-triée ici. Les factures sans aucun candidat sont
// désormais résolues automatiquement côté backend, absentes de la liste.
export function RapprochementPaiementAchatContenu({
  cabinetId,
  dossierId,
  utilisateurId,
  periodeDebut,
  factures: facturesInitiales,
  onCountChange,
}: RapprochementPaiementAchatContenuProps) {
  const [factures, setFactures] = useState(facturesInitiales);

  useEffect(() => {
    onCountChange?.(factures.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factures.length]);

  // Bug réel corrigé (brief v61) : un re-fetch complet de cet onglet après
  // chaque validation (fetchRapprochementsPaiementAchat) vidait toute la
  // liste le temps de l'appel ("Actualisation…"), donnant l'impression que
  // tout se rechargeait à chaque validation — alors qu'un seul élément
  // venait d'être traité. Un paiement validé doit disparaître des
  // candidats des autres factures (brief v35, un même paiement ne peut pas
  // être réclamé deux fois) : comme on connaît déjà exactement les
  // ledgerEntryId venant d'être réclamés (paiementsValides, calculé au
  // moment de la validation), un simple filtrage local suffit — jamais
  // besoin de retourner au serveur pour ça.
  function retirer(factureLedgerEntryId: number, ledgerEntryIdsClaims: number[]) {
    setFactures((prev) =>
      prev
        .filter((f) => f.ledgerEntryId !== factureLedgerEntryId)
        .map((f) =>
          ledgerEntryIdsClaims.length === 0
            ? f
            : { ...f, candidats: f.candidats.filter((c) => !ledgerEntryIdsClaims.includes(c.ledgerEntryId)) }
        )
    );
  }

  return (
    <>
      <p className="reference">
        Factures de service non payées, avec leurs paiements candidats trouvés sur toute la fenêtre de l'exercice.
        Les cases précochées reflètent une suggestion IA quand disponible, à valider ou corriger avant d'envoyer.
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
              periodeDebut={periodeDebut}
              onTraite={(ledgerEntryIdsClaims) => retirer(f.ledgerEntryId, ledgerEntryIdsClaims)}
            />
          ))}
        </ul>
      )}
    </>
  );
}
