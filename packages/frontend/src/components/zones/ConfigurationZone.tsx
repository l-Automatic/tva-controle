import { ConventionsComptesPanel } from '../ConventionsComptesPanel';
import { PropositionsPanel } from '../PropositionsPanel';
import { TauxHistoriquePanel } from '../TauxHistoriquePanel';
import { confirmerConvention, fetchConventions, rejeterConvention } from '../../api';
import { CLES_CONVENTIONS_COMPTES, type CleConventionCompte, type Proposition } from '../../types';

export type SousOngletConfiguration = 'comptes' | 'generiques' | 'taux';

interface ConfigurationZoneProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  sousOnglet: SousOngletConfiguration;
  onChangeSousOnglet: (onglet: SousOngletConfiguration) => void;
}

const ONGLETS: { id: SousOngletConfiguration; libelle: string }[] = [
  { id: 'comptes', libelle: 'Conventions de comptes' },
  { id: 'generiques', libelle: 'Conventions génériques' },
  { id: 'taux', libelle: 'Taux historique' },
];

function libelleConvention(proposition: Proposition): string {
  return `${proposition.cle ?? '—'} : ${JSON.stringify(proposition.valeur)}`;
}

// Les 4 conventions de comptes ont leur propre onglet (ConventionsComptesPanel)
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
}: ConfigurationZoneProps) {
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

      {sousOnglet === 'comptes' && (
        <ConventionsComptesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      )}
      {sousOnglet === 'generiques' && (
        <PropositionsPanel
          title="Conventions génériques"
          cabinetId={cabinetId}
          dossierId={dossierId}
          utilisateurId={utilisateurId}
          fetchPropositions={fetchConventionsGeneriques}
          confirmer={confirmerConvention}
          rejeter={rejeterConvention}
          renderLabel={libelleConvention}
        />
      )}
      {sousOnglet === 'taux' && (
        <TauxHistoriquePanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      )}
    </div>
  );
}
