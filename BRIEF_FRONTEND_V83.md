# Brief frontend v83 — refonte complète du design, en collaboration avec toi

## Contexte honnête
Les briefs v79 à v82 n'ont pas donné ce que Rami voulait. Verdict de
Rami sur le résultat actuel, sans détour : "c'est moche", "on dirait
que rien n'a changé", il n'aime pas les formes actuelles, l'app
utilise toujours Montserrat et le bleu marine partout malgré les
nouveaux tokens ajoutés. La cause : on a ajouté des tokens Stripe à
côté de l'ancien système sur 3 écrans isolés, au lieu de remplacer le
système entier. Rami veut une refonte complète de A à Z, sur toute
l'app — pas des touches ponctuelles.

Tous les choix de forme faits jusqu'ici (l'ombre pulsée y compris)
sont à considérer comme jetables, pas comme un point de départ à
raffiner.

## Direction voulue
Esprit "fintech premium, épuré" — inspiration Stripe/Linear/Ramp/
Vercel. Palette de couleurs proposée dans l'exploration précédente
(voir tokens déjà ajoutés au `:root` par le v81 — neutre/accent/
succès/alerte/danger en échelles 50/100/500/900) comme point de
départ possible, mais rien n'est figé si tu as un meilleur jugement
sur la palette, la typographie, ou les formes.

## Ce qui est demandé — pas juste exécuter, réfléchir avec nous

Avant de coder quoi que ce soit, prends le temps de regarder l'état
réel actuel de l'app (tout le CSS existant, pas seulement les 3
écrans déjà touchés) et propose ton propre plan pour une refonte
complète et cohérente : remplacement de la police de base, de la
palette de couleurs partout (pas juste sur 3 écrans), des formes
(rayons, ombres, espacements), appliqué à *tous* les écrans de l'app,
pas une sélection. Dis-nous concrètement :

- Quelle est l'ampleur réelle du chantier vu depuis le code (combien
  de fichiers CSS, combien de composants, y a-t-il une architecture
  CSS existante qui facilite ou complique une refonte globale) ?
- Quelle approche tu recommandes pour remplacer proprement l'ancien
  système sans le laisser cohabiter avec le nouveau (retrait des
  anciennes règles, pas seulement ajout de nouvelles) ?
- As-tu besoin d'une référence visuelle plus précise de notre part
  avant de te lancer (Rami peut fournir des captures d'écran
  d'inspiration supplémentaires si utile) ?

## Vérification
Pas de code à ce stade — d'abord ton plan et ton avis, qu'on discute
avant de lancer l'exécution réelle.
