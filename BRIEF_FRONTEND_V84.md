# Brief frontend v84 — Phase A de la refonte complète (police + tokens de couleur/ombre)

## Contexte
Suite du v83 : plan validé avec Rami en mode plan, sauvegardé dans
`/root/.claude/plans/stateful-chasing-nova.md`. Ce brief lance
l'exécution de la **Phase A uniquement** — fondations : police +
tokens de couleur/ombre dans `:root`, retrait des anciens tokens.
Ne pas exécuter les phases B, C, D ici — chacune fera l'objet de son
propre brief, une fois la Phase A vérifiée et validée par Rami.

Reprendre exactement le contenu de la Phase A tel que décrit dans le
plan sauvegardé : bascule `font-family` sur la police système (avec
repli `system-ui`, `'Segoe UI'` pour Windows/Linux), retrait des 4
imports `@fontsource/montserrat` dans `main.tsx`, ajout de
`--accent-600` (teinte de survol manquante) et d'un token
violet/agent de remplacement (renommé en cohérence avec le nouveau
système, ex. `--agent-500`/`--agent-100`), repointage de chaque règle
utilisant un ancien token vers son équivalent du nouveau système, puis
suppression des anciens tokens de `:root`.

Rappel du principe déjà acté : repointer, jamais laisser cohabiter.
Une fois la phase terminée, un `grep` sur les anciens noms de tokens
(`--accent` sans les nouveaux suffixes, `--warning`, `--danger`,
`--success`, `--neutral`, `--degrade-actif`, `--shadow-card`) doit
renvoyer zéro dans `styles.css`.

## Vérification
Comme convenu dans le plan : captures de chaque zone principale
(Cycle, Configuration, Historique, Déclaration, Paramètres,
Utilisateurs) avant/après, comparées comme un contrôle de
non-régression — rien ne doit visuellement changer sauf la police (le
repointage doit être fidèle aux couleurs déjà choisies au v81). Tout
écart de couleur au-delà de la police signale une erreur de
repointage, pas un choix de design à cette phase. `npx tsc --noEmit` +
`npx vite build`, suite de tests backend complète.

Une fois cette phase vérifiée et commitée, s'arrêter et attendre le
prochain brief (v85, Phase B) plutôt que d'enchaîner.
