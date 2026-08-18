import { ConventionsComptesPanel } from '../ConventionsComptesPanel';
import { PropositionsPanel } from '../PropositionsPanel';
import { SuggestionsAutoliquidationPanel } from '../SuggestionsAutoliquidationPanel';
import { TauxHistoriquePanel } from '../TauxHistoriquePanel';
import { VehiculesPanel } from '../VehiculesPanel';
import { TauxAssigneZone } from './TauxAssigneZone';
import { ajouterConvention, confirmerConvention, fetchConventions, rejeterConvention } from '../../api';
import {
  CLES_CONVENTIONS_COMPTES,
  type CleConventionCompte,
  type CompteACategoriser,
  type CompteClientSansTauxAssigne,
  type CompteSansTauxAssigne,
  type Proposition,
} from '../../types';

export type SousOngletConfiguration = 'comptes' | 'generiques' | 'taux' | 'tauxAssigne' | 'vehicules';

interface ConfigurationZoneProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  sousOnglet: SousOngletConfiguration;
  onChangeSousOnglet: (onglet: SousOngletConfiguration) => void;
  suggestionsTauxComptes: CompteSansTauxAssigne[];
  suggestionsTauxClients: CompteClientSansTauxAssigne[];
  onSuggestionTauxCompteConsommee: (compte: string) => void;
  onSuggestionTauxClientConsommee: (numeroCompteTiers: string) => void;
  suggestionsAutoliquidation: CompteACategoriser[];
  onSuggestionAutoliquidationConsommee: (compte: string) => void;
}

const ONGLETS: { id: SousOngletConfiguration; libelle: string; description: string }[] = [
  {
    id: 'comptes',
    libelle: 'Conventions de comptes',
    description:
      'Catégorise chaque compte de charge/produit en service, équipement, ou carburant — détermine si la TVA suit la règle du paiement (service) ou de la facturation (bien).',
  },
  {
    id: 'generiques',
    libelle: 'Conventions génériques',
    description:
      "Réglages ponctuels sans catégorie dédiée — aujourd'hui, les comptes utilisés pour l'autoliquidation (prestations intracommunautaires).",
  },
  {
    id: 'taux',
    libelle: 'Taux historique',
    description:
      "Vérifie que le taux de TVA appliqué correspond à l'habitude du dossier — signale un écart, ne choisit rien à ta place.",
  },
  {
    id: 'tauxAssigne',
    libelle: 'Taux assigné',
    description:
      'Attribue directement un taux de TVA à un compte ou un client, une fois pour toutes — utile pour un contrôle de cohérence en fin d’exercice, ou pour éviter d’attendre qu’un historique se constitue.',
  },
  {
    id: 'vehicules',
    libelle: 'Parc de véhicules',
    description:
      'Renseigne les véhicules du dossier — détermine la déductibilité du carburant (tourisme/utilitaire) et signale les flottes mixtes.',
  },
];

function libelleConvention(proposition: Proposition): string {
  return `${proposition.cle ?? '—'} : ${JSON.stringify(proposition.valeur)}`;
}

// Les 5 conventions de comptes ont leur propre onglet (ConventionsComptesPanel)
// — exclues ici pour ne pas apparaître en double dans les "génériques".
async function fetchConventionsGeneriques(cabinetId: string, dossierId: string, statut?: string): Promise<Proposition[]> {
  const toutes = await fetchConventions(cabinetId, dossierId, statut);
  return toutes.filter((p) => !CLES_CONVENTIONS_COMPTES.includes(p.cle as CleConventionCompte));
}

// Regroupe, en sous-onglets internes, tout ce qui configure durablement un
// dossier — visité rarement, pas besoin d'être sur l'écran principal
// (cf. brief refonte, section 3, zone "Configuration du dossier").
export function ConfigurationZone({
  cabinetId,
  dossierId,
  utilisateurId,
  sousOnglet,
  onChangeSousOnglet,
  suggestionsTauxComptes,
  suggestionsTauxClients,
  onSuggestionTauxCompteConsommee,
  onSuggestionTauxClientConsommee,
  suggestionsAutoliquidation,
  onSuggestionAutoliquidationConsommee,
}: ConfigurationZoneProps) {
  const ongletActif = ONGLETS.find((o) => o.id === sousOnglet);

  return (
    <div>
      <nav className="sous-onglets">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            className={`sous-onglet${sousOnglet === o.id ? ' actif' : ''}`}
            onClick={() => onChangeSousOnglet(o.id)}
          >
            {o.libelle}
          </button>
        ))}
      </nav>
      {ongletActif && <p className="sous-onglet-description">{ongletActif.description}</p>}

      <div key={sousOnglet} className="sous-onglet-contenu">
      {sousOnglet === 'comptes' && (
        <ConventionsComptesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      )}
      {sousOnglet === 'generiques' && (
        <>
          <SuggestionsAutoliquidationPanel
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            suggestions={suggestionsAutoliquidation}
            onConsomme={onSuggestionAutoliquidationConsommee}
          />
          <PropositionsPanel
            title="Conventions génériques"
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            fetchPropositions={fetchConventionsGeneriques}
            confirmer={confirmerConvention}
            rejeter={rejeterConvention}
            renderLabel={libelleConvention}
            ajouter={ajouterConvention}
          />
        </>
      )}
      {sousOnglet === 'taux' && (
        <TauxHistoriquePanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      )}
      {sousOnglet === 'tauxAssigne' && (
        <TauxAssigneZone
          cabinetId={cabinetId}
          dossierId={dossierId}
          utilisateurId={utilisateurId}
          suggestionsComptes={suggestionsTauxComptes}
          suggestionsClients={suggestionsTauxClients}
          onSuggestionCompteConsommee={onSuggestionTauxCompteConsommee}
          onSuggestionClientConsommee={onSuggestionTauxClientConsommee}
        />
      )}
      {sousOnglet === 'vehicules' && (
        <VehiculesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      )}
      </div>
    </div>
  );
}
