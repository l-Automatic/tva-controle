// Bug réel corrigé (brief v75, audit des formats français) : les 3 copies
// indépendantes de cette fonction (CalculsPanel.tsx, CycleForm.tsx,
// VehiculesPanel.tsx) ne fixaient qu'un minimum de 2 décimales
// (minimumFractionDigits), jamais de maximum — un montant à 3 décimales ou
// plus (saisie manuelle, ex: parc de véhicules, ou artefact de calcul en
// virgule flottante) s'affichait avec ses décimales excédentaires au lieu
// d'être arrondi à 2, jamais correct pour un montant en euros. Regroupées
// ici en une seule fonction réutilisée partout, pour que ce genre
// d'incohérence ne puisse plus se reproduire composant par composant.
export function formatMontant(montant: number): string {
  return `${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
