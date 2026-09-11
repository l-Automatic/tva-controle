// L'API renvoie des colonnes DATE Postgres sérialisées en ISO complet
// (2025-04-01T00:00:00.000Z) — on ne garde que la partie date pour l'affichage
// et pour les comparaisons (ex : rattacher une anomalie à un calcul de même
// période).
export function toDateOnly(iso: string): string {
  return iso.split('T')[0] ?? iso;
}

// Bug réel corrigé (brief v75, audit des formats français) : cette
// fonction se contentait de renvoyer la date ISO brute (YYYY-MM-DD),
// jamais reformatée — affichée telle quelle dans toute l'app malgré son
// nom. Reformate en JJ/MM/AAAA (convention française demandée par Rami),
// par manipulation de chaîne plutôt que via un objet Date : un Date
// construit depuis une simple date (sans heure) est interprété en UTC
// minuit, et toLocaleDateString le reconvertirait dans le fuseau local du
// navigateur, pouvant décaler le jour affiché de un pour certains fuseaux
// (jamais un souci ici, la date reste la même chaîne du début à la fin).
export function formatDate(iso: string): string {
  const [annee, mois, jour] = toDateOnly(iso).split('-');
  if (!annee || !mois || !jour) return iso;
  return `${jour}/${mois}/${annee}`;
}

export function formatHorodatage(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR');
  } catch {
    return iso;
  }
}
