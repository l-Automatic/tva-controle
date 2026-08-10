import { iconeStatut } from '../icons';

// Badge de statut avec icône — une icône par statut aide à le repérer d'un
// coup d'œil, cohérent partout dans l'app (cf. brief v2, section 4).
export function BadgeStatut({ statut, libelle }: { statut: string; libelle: string }) {
  const Icone = iconeStatut(statut);
  return (
    <span className={`badge statut-${statut}`}>
      <Icone size={11} aria-hidden="true" />
      {libelle}
    </span>
  );
}
