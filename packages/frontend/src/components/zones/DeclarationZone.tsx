import { useEffect, useState } from 'react';
import { ApiError, fetchCalculs, fetchDeclarationCalcul } from '../../api';
import { formatDate } from '../../dateUtils';
import { LIBELLE_STATUT_CALCUL } from '../CalculsPanel';
import { BadgeStatut } from '../BadgeStatut';
import type { Calcul, DeclarationCalcul } from '../../types';

interface DeclarationZoneProps {
  cabinetId: string;
  dossierId: string;
}

// GET /calculs/:calculId/declaration renvoie désormais des entiers (brief
// v52) — jamais de décimales sur cet onglet précisément (le reste du
// produit, panneau de calcul compris, garde formatMontant avec décimales,
// cf. CalculsPanel.tsx — pas le même formatage, volontairement).
function formatMontantEntier(montant: number): string {
  return `${montant.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

// Une ligne CA3 = un numéro de ligne officiel + un montant, ou "Pas encore
// disponible" pour les lignes dont le calcul n'est pas encore construit
// (brief v49, chantier en cours) — jamais un 0€ à la place, qui laisserait
// croire à tort que la ligne est vide plutôt que non calculée.
function LigneDeclaration({
  numero,
  libelle,
  montant,
  disponible = true,
}: {
  numero: string;
  libelle: string;
  montant: number;
  disponible?: boolean;
}) {
  return (
    <li className="card">
      <p className="label">
        <span className="badge badge-origine">{numero}</span> {libelle}
      </p>
      <p className="reference">{disponible ? formatMontantEntier(montant) : 'Pas encore disponible'}</p>
    </li>
  );
}

// Affichage seulement (brief v49, première version) — la possibilité de
// déclarer réellement viendra dans un prochain brief. Onglet séparé du
// panneau de calcul existant (CalculsPanel/CycleForm), volontairement :
// la déclaration CA3 est une lecture dérivée du calcul, pas une action sur
// le calcul lui-même.
function DeclarationCalculView({ cabinetId, calculId }: { cabinetId: string; calculId: string }) {
  const [declaration, setDeclaration] = useState<DeclarationCalcul | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchDeclarationCalcul(cabinetId, calculId)
      .then(setDeclaration)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossible de charger la déclaration'))
      .finally(() => setLoading(false));
  }, [cabinetId, calculId]);

  if (loading) return <p className="empty">Chargement…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!declaration) return null;

  return (
    <ul className="card-list">
      <LigneDeclaration numero="Ligne 1" libelle="TVA collectée" montant={declaration.ligne01CollecteTotal} />
      <li className="card">
        <p className="label">
          <span className="badge badge-origine">Ligne 2</span> TVA collectée par taux
        </p>
        <p className="reference">20 % : {formatMontantEntier(declaration.ligne02ParTaux.taux20)}</p>
        <p className="reference">10 % : {formatMontantEntier(declaration.ligne02ParTaux.taux10)}</p>
        <p className="reference">5,5 % : {formatMontantEntier(declaration.ligne02ParTaux.taux5_5)}</p>
        <p className="reference">2,1 % : {formatMontantEntier(declaration.ligne02ParTaux.taux2_1)}</p>
      </li>
      <li className="card">
        <p className="label">
          <span className="badge badge-origine">Ligne 3</span> Base HT des opérations imposables
        </p>
        <p className="reference">Total : {formatMontantEntier(declaration.ligne03BaseHt.total)}</p>
        <p className="reference">20 % : {formatMontantEntier(declaration.ligne03BaseHt.parTaux.taux20)}</p>
        <p className="reference">10 % : {formatMontantEntier(declaration.ligne03BaseHt.parTaux.taux10)}</p>
        <p className="reference">5,5 % : {formatMontantEntier(declaration.ligne03BaseHt.parTaux.taux5_5)}</p>
        <p className="reference">2,1 % : {formatMontantEntier(declaration.ligne03BaseHt.parTaux.taux2_1)}</p>
      </li>
      <LigneDeclaration
        numero="Ligne 4"
        libelle="TVA due — acquisitions intracommunautaires"
        montant={declaration.ligne04DueIntracom}
      />
      <LigneDeclaration numero="Ligne 6" libelle="Exportations" montant={declaration.ligne06Export} />
      <LigneDeclaration
        numero="Ligne 7"
        libelle="Livraisons intracommunautaires exonérées"
        montant={declaration.ligne07IntracomExoneree}
      />
      <li className="card">
        <p className="label">Autres opérations imposables (sous-traitance BTP)</p>
        <p className="reference">{formatMontantEntier(declaration.autresOperationsImposablesBtp)}</p>
      </li>
      <LigneDeclaration
        numero="Ligne 8"
        libelle="TVA déductible sur biens et services"
        montant={declaration.ligne08DeductibleAbs}
      />
      <LigneDeclaration
        numero="Ligne 9"
        libelle="TVA déductible sur immobilisations"
        montant={declaration.ligne09DeductibleImmo}
      />
      <LigneDeclaration
        numero="Ligne 10"
        libelle="Crédit de TVA antérieur"
        montant={0}
        disponible={declaration.disponible.ligne10CreditAnterieur}
      />
      <li className="card">
        <p className="label montant-principal">
          {declaration.solde.sens === 'a_decaisser' ? 'TVA à décaisser' : 'Crédit de TVA'} :{' '}
          <strong>{formatMontantEntier(declaration.solde.montant)}</strong>
        </p>
      </li>
    </ul>
  );
}

export function DeclarationZone({ cabinetId, dossierId }: DeclarationZoneProps) {
  const [calculs, setCalculs] = useState<Calcul[]>([]);
  const [calculSelectionne, setCalculSelectionne] = useState<Calcul | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cabinetId || !dossierId) return;
    setLoading(true);
    setError(null);
    fetchCalculs(cabinetId, dossierId)
      .then((data) => {
        setCalculs(data);
        setCalculSelectionne((prev) => prev ?? data[0] ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossible de charger les calculs'))
      .finally(() => setLoading(false));
  }, [cabinetId, dossierId]);

  return (
    <div className="cycle-zone-layout">
      <section className="panel cycle-zone-main">
        <div className="panel-header">
          <h2>Calculs</h2>
        </div>
        {error && <p className="error">{error}</p>}
        {!loading && calculs.length === 0 && <p className="empty">Aucun calcul pour ce dossier.</p>}
        <ul className="card-list">
          {calculs.map((c) => (
            <li key={c.id} className={`card${calculSelectionne?.id === c.id ? ' actif' : ''}`}>
              <button className="secondary" onClick={() => setCalculSelectionne(c)}>
                <BadgeStatut statut={c.statut} libelle={LIBELLE_STATUT_CALCUL[c.statut]} />
                {formatDate(c.periodeDebut)} — {formatDate(c.periodeFin)}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <aside className="panel cycle-zone-calcul">
        <div className="panel-header">
          <h2>Déclaration</h2>
        </div>
        {!calculSelectionne ? (
          <p className="empty">Sélectionnez un calcul pour voir sa déclaration.</p>
        ) : (
          <DeclarationCalculView cabinetId={cabinetId} calculId={calculSelectionne.id} />
        )}
      </aside>
    </div>
  );
}
