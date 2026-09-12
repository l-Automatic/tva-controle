# Brief frontend v85 — Phase B de la refonte complète (sidebar + boutons + focus)

## Contexte
Suite du v84 (Phase A terminée et validée, commit `aa94ca0`). Ce
brief lance la **Phase B uniquement**, telle que décrite dans le plan
sauvegardé (`/root/.claude/plans/stateful-chasing-nova.md`) : coquille
de l'app — sidebar, boutons, focus. Ne pas exécuter les phases C et D
ici.

Contenu de la phase, tel que déjà validé avec Rami :
- Sidebar en direction claire (confirmé par Rami au v83) : les 14
  règles `.sidebar-*` actuellement codées pour du texte blanc sur fond
  sombre basculent sur fond quasi-blanc (`--neutre-50`), texte foncé,
  item de navigation actif en `--accent-500` plein, fine bordure
  `--neutre-100` pour séparer du contenu.
- Bouton de base : dégradé retiré au profit de `--accent-500` plein,
  survol sur `--accent-600` (au lieu d'un `opacity`), `:active`
  uniformisé sur `scale(0.98)` (même traitement que les blocs déjà
  scopés au v81).
- `.login-shell` aligné sur le même traitement clair que la sidebar,
  pour ne pas laisser un troisième aplat marine isolé dans l'app.

## Sujet en attente, pas dans cette phase
Le contrôle "dégradé par cabinet" (Paramètres > Apparence), devenu mort
en Phase A — Rami a choisi d'assumer l'écart plutôt que de préserver
la fonctionnalité. Le masquer/supprimer de l'écran Paramètres est
prévu pour la Phase C ou D, pas maintenant — ne pas y toucher dans ce
brief, juste le laisser tel quel (inopérant mais visible), comme
convenu.

## Vérification
Comme convenu dans le plan : focus sur le sidebar (présent sur chaque
zone) et tout écran avec des boutons visibles. `npx tsc --noEmit` +
`npx vite build`, suite de tests backend complète.

Une fois cette phase vérifiée et commitée, s'arrêter et attendre le
prochain brief (v86, Phase C) plutôt que d'enchaîner.
