import { useEffect, useState } from 'react';
import { ApiError, ajusterMontantCalcul, fetchAjustementsCalcul, lancerCycle, retirerAjustementCalcul } from '../api';
import { useToast } from '../toast';
import type { AjustementCalcul, LigneCalcul, ResultatCycle, TypeMontantAjustement } from '../types';
import { CycleLoadingPopup } from './CycleLoadingPopup';
import { InfoTooltip } from './InfoTooltip';

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
}

const LIBELLE_CATEGORIE: Record<string, string> = {
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
  const calculId = resultat.statut === 'calcule' ? resultat.calculId : null;

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

  if (resultat.statut === 'bloque') {
    // Pas de liste détaillée ici : le panneau « Anomalies » juste en dessous
    // (variant="cycle") affiche déjà ces mêmes anomalies, en mieux — libellé
    // lisible, actions Résoudre/Justifier/Qualifier. Les redupliquer ici en
    // lecture seule n'ajoutait rien, juste un doublon moins bien formaté
    // (cf. brief v5, vérification de non-redondance).
    return (
      <div className="resultat-cycle resultat-bloque">
        <p className="resultat-titre">
          Cycle bloqué — {resultat.anomalies.filter((a) => a.gravite === 'bloquant').length} anomalie(s) bloquante(s)
        </p>
        <p className="reference">
          Traitez ces anomalies dans le panneau « Anomalies » ci-dessous, puis relancez le cycle.
        </p>
      </div>
    );
  }

  const { resultat: calcul, calculId: id, anomalies } = resultat;

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
}: CycleFormProps) {
  const [periodeDebut, setPeriodeDebut] = useState('');
  const [periodeFin, setPeriodeFin] = useState('');
  const [pennylaneToken, setPennylaneToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dejaValide, setDejaValide] = useState(false);
  const [resultat, setResultat] = useState<ResultatCycle | null>(null);
  const [phasePopup, setPhasePopup] = useState<'chargement' | 'succes' | null>(null);
  const [messageSucces, setMessageSucces] = useState('');
  const notifier = useToast();

  async function handleLancer() {
    if (!periodeDebut || !periodeFin || !pennylaneToken) {
      setError('Période de début, période de fin et token Pennylane sont requis');
      return;
    }
    setSubmitting(true);
    setPhasePopup('chargement');
    setError(null);
    setDejaValide(false);
    setResultat(null);
    try {
      const res = await lancerCycle(cabinetId, dossierId, { periodeDebut, periodeFin, pennylaneToken });
      setResultat(res);
      setPennylaneToken('');
      const message = res.statut === 'bloque' ? 'Cycle bloqué — anomalies à traiter' : 'Cycle calculé';
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
        setDejaValide(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec du lancement du cycle');
      }
    } finally {
      setSubmitting(false);
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
        <label className="cycle-form-token">
          Token Pennylane
          <input
            type="password"
            placeholder="Token à usage unique — régénérez-le après ce test"
            value={pennylaneToken}
            onChange={(e) => setPennylaneToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button onClick={() => void handleLancer()} disabled={submitting}>
          {submitting ? 'Cycle en cours…' : 'Lancer le cycle'}
        </button>
      </div>
      <p className="reference cycle-form-warning">
        Le token est transmis en clair au serveur (pas de gestion de secrets à ce stade) — ne réutilisez jamais un
        token déjà collé ailleurs, régénérez-le avant chaque test.
      </p>

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
    </div>
  );
}
