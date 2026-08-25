// Table de référence déterministe, construite le 10/08 à partir de
// l'expertise de Rami sur un plan comptable réellement utilisé (pas un PCG
// théorique) — https://www.calebgestion.com/cours_comptabilite/c51_pcg6_complet.htm
// comme point de départ, corrigé et affiné compte par compte par Rami.
//
// Objectif : court-circuiter complètement l'appel LLM pour les comptes où
// aucune ambiguïté n'existe jamais en pratique — économie de coût/latence,
// et surtout zéro risque qu'un modèle se trompe sur un cas qui n'a jamais
// été incertain. Réservé aux cas dits "toujours X" par Rami ; tout ce qui
// a été nuancé ("normalement", "il faudrait vérifier") reste dans le
// circuit IA, cf. pipeline.ts.
//
// `categorie: null` signifie "systématiquement un bien" — aucune des 6
// catégories du popup ne s'applique, jamais rien à confirmer pour ce
// compte. Comparaison par préfixe, comme partout ailleurs dans ce module.
export interface EntreeReferentielCompte {
  prefixe: string;
  categorie: string | null;
  justification: string;
}

export const REFERENTIEL_COMPTES_CHARGE: EntreeReferentielCompte[] = [
  // --- Toujours un bien (jamais une des 6 catégories du popup) ---
  { prefixe: '601', categorie: null, justification: 'Achats de matières premières et fournitures : toujours un bien.' },
  { prefixe: '602', categorie: null, justification: 'Achats stockés (autres approvisionnements) : toujours un bien.' },
  { prefixe: '606110', categorie: null, justification: 'Fournitures non stockables : toujours un bien.' },
  { prefixe: '606120', categorie: null, justification: 'Fournitures non stockables : toujours un bien.' },
  { prefixe: '606130', categorie: null, justification: 'Fournitures non stockables : toujours un bien.' },
  { prefixe: '6063', categorie: null, justification: 'Fournitures d\'entretien et de petit équipement : toujours un bien.' },
  { prefixe: '6064', categorie: null, justification: 'Fournitures administratives : toujours un bien.' },
  { prefixe: '607', categorie: null, justification: 'Achats de marchandises : toujours un bien.' },
  { prefixe: '6236', categorie: null, justification: 'Catalogues et imprimés publicitaires : toujours un bien, contrairement au reste du compte 623.' },

  // --- Toujours une prestation de service ---
  { prefixe: '604', categorie: 'comptes_charge_service', justification: 'Achats d\'études et prestations de services : toujours un service.' },
  { prefixe: '611', categorie: 'comptes_charge_service', justification: 'Sous-traitance générale : toujours un service.' },
  { prefixe: '612', categorie: 'comptes_charge_service', justification: 'Redevances de crédit-bail : toujours un service.' },
  { prefixe: '613', categorie: 'comptes_charge_service', justification: 'Locations : toujours un service.' },
  { prefixe: '614', categorie: 'comptes_charge_service', justification: 'Charges locatives et de copropriété : toujours un service.' },
  { prefixe: '615', categorie: 'comptes_charge_service', justification: 'Entretiens et réparations : toujours un service.' },
  { prefixe: '617', categorie: 'comptes_charge_service', justification: 'Études et recherches : toujours un service.' },
  { prefixe: '621', categorie: 'comptes_charge_service', justification: 'Personnel extérieur à l\'entreprise : toujours un service.' },
  { prefixe: '622', categorie: 'comptes_charge_service', justification: 'Rémunérations d\'intermédiaires et honoraires : toujours un service.' },
  { prefixe: '628', categorie: 'comptes_charge_service', justification: 'Divers services extérieurs : toujours un service.' },
  { prefixe: '651', categorie: 'comptes_charge_service', justification: 'Redevances (licences, brevets, logiciels) : toujours un service.' },
];

// Recherche par préfixe le plus SPÉCIFIQUE d'abord (ex: '606140' doit
// matcher avant '6061' si les deux existaient) — trié par longueur de
// préfixe décroissante pour garantir ce comportement, peu importe l'ordre
// de déclaration ci-dessus.
export function chercherDansReferentiel(compte: string): EntreeReferentielCompte | null {
  const correspondances = REFERENTIEL_COMPTES_CHARGE.filter((e) => compte.startsWith(e.prefixe));
  if (correspondances.length === 0) return null;
  return correspondances.sort((a, b) => b.prefixe.length - a.prefixe.length)[0]!;
}
