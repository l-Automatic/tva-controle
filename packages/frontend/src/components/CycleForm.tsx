import { useEffect, useState } from 'react';
import {
  ApiError,
  ajusterMontantCalcul,
  fetchAjustementsCalcul,
  fetchComptesACategoriser,
  fetchRapprochementsPaiementAchat,
  lancerCycle,
  retirerAjustementCalcul,
} from '../api';
import { useToast } from '../toast';
import type { AjustementCalcul, CompteACategoriser, FactureARapprocher, LigneCalcul, ResultatCycle, TypeMontantAjustement } from '../types';
import { MessageCalculIncomplet } from './CalculsPanel';
import { CategorisationPopup } from './CategorisationPopup';
import { CycleLoadingPopup } from './CycleLoadingPopup';
import { InfoTooltip } from './InfoTooltip';
import { RapprochementPaiementAchatPopup } from './RapprochementPaiementAchatPopup';

interface CycleFormProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onCycleLance?: (periodeDebut: string, periodeFin: string, resultat: ResultatCycle) => void;
  // Appelé après un ajustement/retrait réussi (brief v23) — permet au
  // parent (CycleZone, sibling de CalculsDuCycle) de resynchroniser le
  // panneau "Calcul de la période" juste en dessous, qui affiche sinon une
  // TVA nette périmée après un ajustement fait ici.
  onAjustementChange?: () => void;
  // Troisième porte obligatoire (brief v38), même principe que les deux
  // précédentes mais sans payload structuré — juste un message d'erreur à
  // reconnaître, pour rediriger vers Configuration du dossier → Parc de
  // véhicules plutôt que d'afficher le 409 brut.
  onParcVehiculesManquant?: (() => void) | undefined;
}

export const LIBELLE_CATEGORIE: Record<string, string> = {
  collectee_20: 'Collectée 20 %',
  collectee_10: 'Collectée 10 %',
  collectee_5_5: 'Collectée 5,5 %',
  collectee_2_1: 'Collectée 2,1 %',
  deductible_abs: 'Déductible (biens/services)',
  deductible_immo: 'Déductible (immobilisations)',
  autoliquidation_due: 'Autoliquidation due',
  autoliquidation_deductible: 'Autoliquidation déductible',
};

function formatMontant(montant: number): string {
  return `${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
}

// Même regroupement que calculerTva (calcul-module7/src/calcul.ts) :
// l'autoliquidation due s'ajoute au côté collecté, l'autoliquidation
// déductible au côté déductible — tvaNette = collectée - déductible.
const CATEGORIES_COLLECTEE = ['collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1', 'autoliquidation_due'];
const CATEGORIES_DEDUCTIBLE = ['deductible_abs', 'deductible_immo', 'autoliquidation_deductible'];

function sommeCategories(lignes: LigneCalcul[], categories: string[]): number {
  return lignes.filter((l) => categories.includes(l.categorie)).reduce((acc, l) => acc + l.montant, 0);
}

const LIBELLE_TYPE_MONTANT: Record<TypeMontantAjustement, string> = {
  collectee_totale: 'TVA collectée',
  deductible_totale: 'TVA déductible',
};

// Ajustement manuel d'un des deux totaux (brief v23) — additif côté
// backend, restreint aux calculs encore brouillon. montantCalcule est
// TOUJOURS le montant produit par le moteur (dérivé des lignes du calcul
// juste reçu), jamais la valeur d'un ajustement précédent — même en
// modifiant un ajustement déjà actif, c'est cette valeur qui part comme
// montantOriginal (le backend la préserve de toute façon à travers
// plusieurs modifications, mais autant ne jamais lui envoyer autre chose).
function AjustementLigne({
  cabinetId,
  calculId,
  utilisateurId,
  typeMontant,
  montantCalcule,
  ajustement,
  onChange,
}: {
  cabinetId: string;
  calculId: string;
  utilisateurId: string;
  typeMontant: TypeMontantAjustement;
  montantCalcule: number;
  ajustement: AjustementCalcul | undefined;
  onChange: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [nouveauMontant, setNouveauMontant] = useState('');
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  // Champ vide au départ (brief v24) — décision explicite de Rami : le
  // collaborateur saisit le montant lui-même, aucune valeur suggérée.
  // montantOriginal envoyé au backend reste montantCalcule (donnée interne),
  // indépendant de ce qui s'affiche dans ce champ.
  function ouvrirFormulaire() {
    setNouveauMontant('');
    setJustification('');
    setError(null);
    setOuvert(true);
  }

  async function handleEnregistrer() {
    const valeur = Number.parseFloat(nouveauMontant.replace(',', '.'));
    if (Number.isNaN(valeur)) {
      setError('Montant invalide');
      return;
    }
    if (!justification.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await ajusterMontantCalcul(cabinetId, calculId, {
        typeMontant,
        montantOriginal: montantCalcule,
        montantAjuste: valeur,
        justification: justification.trim(),
        utilisateurId,
      });
      notifier(`${LIBELLE_TYPE_MONTANT[typeMontant]} ajustée`);
      setOuvert(false);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'ajustement");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetirer() {
    setSubmitting(true);
    setError(null);
    try {
      await retirerAjustementCalcul(cabinetId, calculId, typeMontant, utilisateurId);
      notifier('Ajustement retiré — montant d’origine rétabli');
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du retrait de l’ajustement');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="card">
      <p className="label">
        {LIBELLE_TYPE_MONTANT[typeMontant]} :{' '}
        {ajustement ? (
          <>
            <s className="montant-original">{formatMontant(ajustement.montantOriginal)}</s>{' '}
            <strong>{formatMontant(ajustement.montantAjuste)}</strong>
            <InfoTooltip texte={ajustement.justification} />
          </>
        ) : (
          <strong>{formatMontant(montantCalcule)}</strong>
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {ouvert ? (
        <div className="cycle-form">
          <label>
            Nouveau montant
            <input
              type="text"
              inputMode="decimal"
              value={nouveauMontant}
              onChange={(e) => setNouveauMontant(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            Justification
            <input
              type="text"
              placeholder="Raison de l'ajustement (obligatoire)"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              disabled={submitting}
            />
          </label>
          <button onClick={() => void handleEnregistrer()} disabled={submitting || !justification.trim()}>
            {submitting ? '…' : 'Enregistrer'}
          </button>
          <button className="secondary" onClick={() => setOuvert(false)} disabled={submitting}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="actions">
          <button className="secondary" onClick={ouvrirFormulaire} disabled={submitting}>
            {ajustement ? 'Modifier l’ajustement' : 'Ajuster'}
          </button>
          {ajustement && (
            <button className="secondary" onClick={() => void handleRetirer()} disabled={submitting}>
              {submitting ? '…' : 'Retirer l’ajustement'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function ResultatCycleView({
  resultat,
  cabinetId,
  utilisateurId,
  onAjustementChange,
}: {
  resultat: ResultatCycle;
  cabinetId: string;
  utilisateurId: string;
  onAjustementChange?: () => void;
}) {
  const [ajustements, setAjustements] = useState<AjustementCalcul[]>([]);
  const calculId = resultat.calculId;

  async function chargerAjustements(id: string) {
    try {
      setAjustements(await fetchAjustementsCalcul(cabinetId, id));
    } catch {
      // Silencieux : l'absence d'ajustements affichés n'empêche pas de
      // consulter le reste du résultat, et la liste reste rafraîchissable
      // implicitement en rouvrant le formulaire d'ajustement.
    }
  }

  useEffect(() => {
    if (calculId) void chargerAjustements(calculId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculId]);

  const { resultat: calcul, calculId: id, anomalies, anomaliesBloquantesOuvertes } = resultat;

  // Totaux produits par le moteur, dérivés des lignes de CE calcul — seul
  // endroit où ils sont connus côté frontend (cf. types.ts, brief v23).
  const collecteeCalculee = sommeCategories(calcul.lignes, CATEGORIES_COLLECTEE);
  const deductibleCalculee = sommeCategories(calcul.lignes, CATEGORIES_DEDUCTIBLE);
  const ajustementCollectee = ajustements.find((a) => a.typeMontant === 'collectee_totale');
  const ajustementDeductible = ajustements.find((a) => a.typeMontant === 'deductible_totale');

  // Recalcul pur affichage (brief v23, section 3) — jamais stocké tel quel
  // côté backend, qui ne conserve que les deux totaux ajustés séparément.
  const collecteeAffichee = ajustementCollectee ? ajustementCollectee.montantAjuste : collecteeCalculee;
  const deductibleAffichee = ajustementDeductible ? ajustementDeductible.montantAjuste : deductibleCalculee;
  const netSigne = collecteeAffichee - deductibleAffichee;
  const tvaNetteAffichee = Math.abs(netSigne);
  const sensAffiche: 'a_decaisser' | 'credit' = netSigne >= 0 ? 'a_decaisser' : 'credit';
  const aUnAjustementActif = Boolean(ajustementCollectee || ajustementDeductible);

  return (
    <div className="resultat-cycle resultat-calcule">
      <p className="resultat-titre">
        {sensAffiche === 'a_decaisser' ? 'TVA à décaisser' : 'Crédit de TVA'} :{' '}
        <strong>{formatMontant(tvaNetteAffichee)}</strong>
        {aUnAjustementActif && <span className="reference"> (recalculée à partir des montants ajustés)</span>}
      </p>
      {anomaliesBloquantesOuvertes > 0 && <MessageCalculIncomplet nombre={anomaliesBloquantesOuvertes} />}
      <p className="reference">Calcul {id} (brouillon — à valider dans le panneau « Calculs »)</p>

      <ul className="card-list">
        <AjustementLigne
          cabinetId={cabinetId}
          calculId={id}
          utilisateurId={utilisateurId}
          typeMontant="collectee_totale"
          montantCalcule={collecteeCalculee}
          ajustement={ajustementCollectee}
          onChange={() => {
            void chargerAjustements(id);
            onAjustementChange?.();
          }}
        />
        <AjustementLigne
          cabinetId={cabinetId}
          calculId={id}
          utilisateurId={utilisateurId}
          typeMontant="deductible_totale"
          montantCalcule={deductibleCalculee}
          ajustement={ajustementDeductible}
          onChange={() => {
            void chargerAjustements(id);
            onAjustementChange?.();
          }}
        />
      </ul>

      {calcul.lignes.length > 0 && (
        <table className="table-lignes-calcul">
          <thead>
            <tr>
              <th>Catégorie</th>
              <th>Montant</th>
              <th>Pièces</th>
            </tr>
          </thead>
          <tbody>
            {calcul.lignes.map((l, i) => (
              <tr key={i}>
                <td>{LIBELLE_CATEGORIE[l.categorie] ?? l.categorie}</td>
                <td>{l.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td>
                <td>{l.referencesPieces.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {calcul.ecrituresExclues.length > 0 && (
        <>
          <p className="reference">Écritures exclues du calcul ({calcul.ecrituresExclues.length}) :</p>
          <ul className="card-list">
            {calcul.ecrituresExclues.map((e, i) => (
              <li key={i} className="card">
                <p className="label">
                  Compte {e.compte} — pièce {e.ledgerEntryId}
                </p>
                <p className="reference">{e.motif}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {anomalies.length > 0 && (
        <>
          <p className="reference">{anomalies.length} anomalie(s) non bloquante(s) — voir le panneau « Anomalies ».</p>
        </>
      )}
    </div>
  );
}

export function CycleForm({
  cabinetId,
  dossierId,
  utilisateurId,
  onCycleLance,
  onAjustementChange = () => {},
  onParcVehiculesManquant = () => {},
}: CycleFormProps) {
  const [periodeDebut, setPeriodeDebut] = useState('');
  const [periodeFin, setPeriodeFin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dejaValide, setDejaValide] = useState(false);
  const [resultat, setResultat] = useState<ResultatCycle | null>(null);
  const [phasePopup, setPhasePopup] = useState<'chargement' | 'succes' | null>(null);
  const [messageSucces, setMessageSucces] = useState('');
  // Deux portes obligatoires avant un cycle (brief v34) — jamais rattrapées
  // après coup, contrairement à encaissement_non_affecte. Popups ouverts
  // soit directement (boutons "Vérifier…", consultable à tout moment, pas
  // seulement en réaction à un 409), soit pré-remplis depuis le corps d'un
  // 409 de lancerCycle, sans second appel réseau.
  const [comptesACategoriser, setComptesACategoriser] = useState<CompteACategoriser[] | null>(null);
  const [facturesARapprocher, setFacturesARapprocher] = useState<FactureARapprocher[] | null>(null);
  const [verificationEnCours, setVerificationEnCours] = useState<'categorisation' | 'rapprochement' | null>(null);
  const notifier = useToast();

  async function handleLancer() {
    if (!periodeDebut || !periodeFin) {
      setError('Période de début et période de fin sont requises');
      return;
    }
    setSubmitting(true);
    setPhasePopup('chargement');
    setError(null);
    setDejaValide(false);
    setResultat(null);
    try {
      // pennylaneToken retiré (brief v27) — le backend résout maintenant
      // lui-même le client Pennylane depuis le jeton cabinet configuré.
      const res = await lancerCycle(cabinetId, dossierId, { periodeDebut, periodeFin });
      setResultat(res);
      const message =
        res.anomaliesBloquantesOuvertes > 0
          ? `Cycle calculé — ${res.anomaliesBloquantesOuvertes} anomalie(s) bloquante(s) à traiter`
          : 'Cycle calculé';
      notifier(message);
      setMessageSucces(message);
      setPhasePopup('succes');
      onCycleLance?.(periodeDebut, periodeFin, res);
      // Le check se laisse le temps de se dessiner avant que le popup ne se
      // ferme — le résultat, déjà en place derrière, apparaît alors normalement.
      setTimeout(() => setPhasePopup(null), 1100);
    } catch (err) {
      setPhasePopup(null);
      if (err instanceof ApiError && err.status === 409) {
        const corps = err.corps as
          | { comptesACategoriser?: CompteACategoriser[]; facturesARapprocher?: FactureARapprocher[] }
          | undefined;
        if (corps?.comptesACategoriser) {
          setComptesACategoriser(corps.comptesACategoriser);
        } else if (corps?.facturesARapprocher) {
          setFacturesARapprocher(corps.facturesARapprocher);
        } else if (err.message.includes('parc de véhicules')) {
          // Troisième porte (brief v38) — pas de payload structuré à
          // pré-remplir cette fois, juste une redirection vers l'écran de
          // gestion du parc (Configuration du dossier → Parc de véhicules).
          onParcVehiculesManquant();
        } else {
          setDejaValide(true);
        }
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec du lancement du cycle');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifierCategorisation() {
    if (!periodeDebut || !periodeFin) {
      setError('Période de début et période de fin sont requises');
      return;
    }
    setVerificationEnCours('categorisation');
    setError(null);
    try {
      const comptes = await fetchComptesACategoriser(cabinetId, dossierId, periodeDebut, periodeFin);
      if (comptes.length === 0) {
        notifier('Aucun compte à catégoriser pour cette période');
      } else {
        setComptesACategoriser(comptes);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la vérification de la catégorisation');
    } finally {
      setVerificationEnCours(null);
    }
  }

  async function handleVerifierRapprochement() {
    if (!periodeDebut || !periodeFin) {
      setError('Période de début et période de fin sont requises');
      return;
    }
    setVerificationEnCours('rapprochement');
    setError(null);
    try {
      const factures = await fetchRapprochementsPaiementAchat(cabinetId, dossierId, periodeDebut, periodeFin);
      if (factures.length === 0) {
        notifier('Aucune facture à rapprocher pour cette période');
      } else {
        setFacturesARapprocher(factures);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la vérification du rapprochement');
    } finally {
      setVerificationEnCours(null);
    }
  }

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h2>Lancer un cycle TVA</h2>
      </div>

      <div className="cycle-form">
        <label>
          Période — début
          <input type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
        </label>
        <label>
          Période — fin
          <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
        </label>
        <button onClick={() => void handleLancer()} disabled={submitting}>
          {submitting ? 'Cycle en cours…' : 'Lancer le cycle'}
        </button>
      </div>

      {/* Deux portes obligatoires (brief v34) — consultables à tout moment,
          pas seulement en réaction à un 409 au lancement du cycle. */}
      <div className="cycle-form">
        <button
          className="secondary"
          onClick={() => void handleVerifierCategorisation()}
          disabled={verificationEnCours !== null}
        >
          {verificationEnCours === 'categorisation' ? '…' : 'Vérifier la catégorisation'}
        </button>
        <button
          className="secondary"
          onClick={() => void handleVerifierRapprochement()}
          disabled={verificationEnCours !== null}
        >
          {verificationEnCours === 'rapprochement' ? '…' : 'Vérifier les rapprochements paiements achats'}
        </button>
      </div>

      {error && <p className={dejaValide ? 'error error-409' : 'error'}>{error}</p>}
      {resultat && (
        <ResultatCycleView
          resultat={resultat}
          cabinetId={cabinetId}
          utilisateurId={utilisateurId}
          onAjustementChange={onAjustementChange}
        />
      )}
      {phasePopup && <CycleLoadingPopup phase={phasePopup} messageSucces={messageSucces} />}
      {comptesACategoriser && (
        <CategorisationPopup
          cabinetId={cabinetId}
          dossierId={dossierId}
          utilisateurId={utilisateurId}
          comptes={comptesACategoriser}
          onClose={() => setComptesACategoriser(null)}
        />
      )}
      {facturesARapprocher && (
        <RapprochementPaiementAchatPopup
          cabinetId={cabinetId}
          dossierId={dossierId}
          utilisateurId={utilisateurId}
          periodeDebut={periodeDebut}
          periodeFin={periodeFin}
          factures={facturesARapprocher}
          onClose={() => setFacturesARapprocher(null)}
        />
      )}
    </div>
  );
}
