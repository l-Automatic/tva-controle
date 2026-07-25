// Exécute fn sur chaque item avec au plus `concurrence` appels simultanés.
// Nécessaire dès qu'on boucle sur un nombre de pièces inconnu à l'avance
// (fetchLignesDePiece est un appel par pièce) — sans ça, un mois avec
// beaucoup d'écritures dépasse vite la limite de 25 requêtes/5s de l'API.
export async function mapAvecConcurrenceLimitee<T, R>(
  items: T[],
  concurrence: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const resultats: R[] = new Array(items.length);
  let curseur = 0;

  async function travailleur(): Promise<void> {
    for (;;) {
      const index = curseur;
      curseur += 1;
      if (index >= items.length) {
        return;
      }
      resultats[index] = await fn(items[index] as T, index);
    }
  }

  const nbTravailleurs = Math.min(concurrence, items.length);
  await Promise.all(Array.from({ length: nbTravailleurs }, () => travailleur()));

  return resultats;
}
