import { useState } from 'react';
import { AnomaliesPanel } from './components/AnomaliesPanel';
import { AuditPanel } from './components/AuditPanel';
import { CalculsPanel } from './components/CalculsPanel';
import { ConventionsComptesPanel } from './components/ConventionsComptesPanel';
import { CycleForm } from './components/CycleForm';
import { ParametresPanel } from './components/ParametresPanel';
import { PropositionsPanel } from './components/PropositionsPanel';
import {
  confirmerConvention,
  confirmerTauxHistorique,
  fetchConventions,
  fetchTauxHistorique,
  rejeterConvention,
  rejeterTauxHistorique,
} from './api';
import { CLES_CONVENTIONS_COMPTES, type CleConventionCompte, type Proposition } from './types';

const STORAGE_KEY = 'module6.identite';

interface Identite {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

function chargerIdentite(): Identite {
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    if (brut) return JSON.parse(brut) as Identite;
  } catch {
    // localStorage indisponible ou contenu invalide, on repart des valeurs par défaut
  }
  return { cabinetId: '', dossierId: '', utilisateurId: '' };
}

function libelleConvention(proposition: Proposition): string {
  return `${proposition.cle ?? '—'} : ${JSON.stringify(proposition.valeur)}`;
}

function libelleTaux(proposition: Proposition): string {
  return `Compte ${proposition.compteProduitOuCharge ?? '—'} — taux habituel ${proposition.tauxHabituel ?? '—'}%`;
}

// Les 4 conventions de comptes ont leur propre panneau dédié
// (ConventionsComptesPanel) — on les exclut ici pour ne pas les afficher en
// double dans le panneau générique "Conventions".
async function fetchConventionsAutoliquidation(
  cabinetId: string,
  dossierId: string,
  statut?: string
): Promise<Proposition[]> {
  const toutes = await fetchConventions(cabinetId, dossierId, statut);
  return toutes.filter((p) => !CLES_CONVENTIONS_COMPTES.includes(p.cle as CleConventionCompte));
}

export function App() {
  const [identite, setIdentite] = useState<Identite>(chargerIdentite);

  function mettreAJour(champ: keyof Identite, valeur: string) {
    const suivante = { ...identite, [champ]: valeur };
    setIdentite(suivante);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(suivante));
  }

  const { cabinetId, dossierId, utilisateurId } = identite;
  const contexteComplet = Boolean(cabinetId && dossierId && utilisateurId);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Module 6 — Validation humaine</h1>
        <div className="identite-form">
          <label>
            Cabinet (x-cabinet-id)
            <input
              type="text"
              value={cabinetId}
              onChange={(e) => mettreAJour('cabinetId', e.target.value)}
              placeholder="UUID du cabinet"
            />
          </label>
          <label>
            Dossier
            <input
              type="text"
              value={dossierId}
              onChange={(e) => mettreAJour('dossierId', e.target.value)}
              placeholder="UUID du dossier"
            />
          </label>
          <label>
            Utilisateur
            <input
              type="text"
              value={utilisateurId}
              onChange={(e) => mettreAJour('utilisateurId', e.target.value)}
              placeholder="UUID de l'utilisateur"
            />
          </label>
        </div>
      </header>

      {!contexteComplet ? (
        <p className="empty">Renseignez le cabinet, le dossier et l'utilisateur pour commencer.</p>
      ) : (
        <main className="app-main">
          <CycleForm cabinetId={cabinetId} dossierId={dossierId} />
          <CalculsPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
          <AnomaliesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
          <ConventionsComptesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
          <PropositionsPanel
            title="Conventions"
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            fetchPropositions={fetchConventionsAutoliquidation}
            confirmer={confirmerConvention}
            rejeter={rejeterConvention}
            renderLabel={libelleConvention}
          />
          <PropositionsPanel
            title="Taux historique"
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            fetchPropositions={fetchTauxHistorique}
            confirmer={confirmerTauxHistorique}
            rejeter={rejeterTauxHistorique}
            renderLabel={libelleTaux}
          />
          <ParametresPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
          <AuditPanel cabinetId={cabinetId} dossierId={dossierId} />
        </main>
      )}
    </div>
  );
}
