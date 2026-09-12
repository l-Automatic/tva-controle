# Brief frontend v86 — Phase C de la refonte complète (cartes, panneaux, typographie, nettoyage)

## Contexte
Suite du v85 (Phase B terminée et validée, commit `761cb54`). Ce
brief lance la **Phase C uniquement**, telle que décrite dans le plan
sauvegardé (`/root/.claude/plans/stateful-chasing-nova.md`). Ne pas
exécuter la Phase D ici.

Contenu de la phase, tel que déjà validé avec Rami :
- Bascule `.card`/`.panel` de base sur le traitement décidé au v83 :
  fond `--neutre-50`, `--rayon-carte`, `--ombre-carte-repos`/`--ombre-carte-survol`
  — devient le nouveau défaut universel. Le traitement "carte
  d'anomalie" (contour complet coloré + ombre pulsée) reste un cas
  volontairement à part, jamais généralisé — ne pas y toucher, c'est
  un choix délibéré (signal d'urgence), pas un oubli.
- Application des tokens `--typo-h1/h2/h3/legende` aux titres
  génériques (h1-h4, `.panel-header h2/h3`, `.card-header`).
- Normalisation des 25 valeurs de rayon codées en dur vers
  `var(--radius)` (contrôles) ou `var(--rayon-carte)` (cartes), et des
  hex isolés qui dupliquent déjà un token (`#d92d20`, `#ffd7d0`) vers
  leur équivalent.
- Point à trancher pendant cette phase, pas avant (ça dépend du rendu
  une fois appliqué) : le survol "soulèvement" (`translateY(-2px)`)
  généralisé à toute `.card` peut donner un effet "cliquable" trompeur
  sur des cartes purement informatives — si c'est le cas une fois vu,
  le restreindre à une classe `.card.interactif` plutôt que la règle
  de base. Décision à prendre sur place, avec justification dans le
  rapport.

## Vérification
Comme convenu dans le plan : tour des 5 zones + tous les popups
(Vérifications préalables, Catégorisation, Rapprochement, chargement
de cycle) pour le rendu carte/panneau/typographie. Fixture dédiée avec
une anomalie de chaque gravité/statut visible en même temps, pour
éviter de recharger l'écran plusieurs fois. `npx tsc --noEmit` +
`npx vite build`, suite de tests backend complète.

Une fois cette phase vérifiée et commitée, s'arrêter et attendre le
prochain brief (v87, Phase D) plutôt que d'enchaîner.
