// L'API renvoie des colonnes DATE Postgres sérialisées en ISO complet
// (2025-04-01T00:00:00.000Z) — on ne garde que la partie date pour l'affichage
// et pour les comparaisons (ex : rattacher une anomalie à un calcul de même
// période).
export function toDateOnly(iso: string): string {
  return iso.split('T')[0] ?? iso;
}

export function formatDate(iso: string): string {
  return toDateOnly(iso);
}

export function formatHorodatage(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR');
  } catch {
    return iso;
  }
}
