# Brief frontend v81 — nouveau système de design (direction "Stripe"), déployé par étapes

## Contexte
Rami veut une refonte esthétique en profondeur, direction "fintech
premium" (Stripe/Linear/Ramp/Vercel), après avoir validé une direction
visuelle concrète avec Claude (palette, typographie, composants).
Vu l'ampleur (des dizaines d'écrans construits au fil de nombreuses
sessions), on procède **par étapes** plutôt qu'en une seule passe :
d'abord les fondations (tokens), appliquées à quelques écrans de
référence, pour validation avant généralisation.

## Étape 1 — Fondations : variables CSS

Définir ces tokens en variables CSS (root), à réutiliser partout —
jamais de couleur ou de taille en dur dans les composants après ça.

### Palette
```
--neutre-50:  #F9FAFB
--neutre-100: #EAECF0
--neutre-500: #98A2B3
--neutre-900: #101828

--accent-50:  #EDF2FF
--accent-100: #C7D2FE
--accent-500: #4F46E5
--accent-900: #312E81

--succes-50:  #ECFDF3
--succes-100: #A6F4C5
--succes-500: #12B76A
--succes-900: #054F31

--alerte-50:  #FEF6E7
--alerte-100: #FDE29A
--alerte-500: #F5A623
--alerte-900: #7A4A08

--danger-50:  #FEF3F2
--danger-100: #FECDCA
--danger-500: #D92D20
--danger-900: #7A271A
```
Note pour Claude Code : l'accent indigo (--accent-500) est un choix
provisoire de Rami/Claude pendant la phase d'exploration — pas figé,
peut être ajusté après retour visuel. Le reste de la palette
(neutre/succès/alerte/danger) est plus assuré.

### Typographie
Police système (`-apple-system, 'Helvetica Neue', sans-serif` en
fallback) plutôt qu'une police chargée à part, pour rester léger.
```
H1 — 28px, weight 600, letter-spacing -0.03em (titres de page)
H2 — 20px, weight 600, letter-spacing -0.02em (titres de section)
H3 — 15px, weight 500 (sous-titres, libellés de carte)
Corps — 14px, weight 400, line-height 1.6
Légende — 12px, weight 400, couleur --neutre-500
```

### Rayons et ombres
```
Rayon boutons/champs : 8px
Rayon cartes : 12px
Ombre carte (repos) : 0 1px 3px rgba(16,24,40,0.1), 0 1px 2px rgba(16,24,40,0.06)
Ombre carte (survol) : 0 4px 8px rgba(16,24,40,0.1), 0 2px 4px rgba(16,24,40,0.06)
```

### Animations légères
- Cartes cliquables : `transform: translateY(-2px)` au survol, transition
  `150ms ease` sur transform + box-shadow.
- Boutons : transition `150ms ease` sur background/border, léger
  `scale(0.98)` à l'état actif (clic).
- Rien de plus appuyé — l'objectif est la fluidité, jamais un effet
  qui distrait.

## Étape 2 — Appliquer à 3 écrans de référence, pas plus pour l'instant

1. **Les cartes d'anomalies** (déjà retravaillées aux v79/v80 — les
   adapter à cette nouvelle palette plutôt que les couleurs
   actuelles : contour + ombre pulsée en `--danger-500` pour
   bloquant, `--alerte-500` pour signalé).
2. **Le popup "Vérifications préalables"** — badges d'onglets avec
   compteur, fond des cartes en blanc/neutre-50, boutons dans le
   nouveau style.
3. **Un troisième écran au choix de Claude Code** — celui qui
   bénéficierait le plus visiblement du changement pour donner à Rami
   un aperçu représentatif (ex: la liste des dossiers, ou l'écran de
   calcul avec les cartes de montants).

**Ne pas toucher au reste de l'app pour l'instant** — l'objectif de
cette étape est que Rami voie le rendu sur un périmètre limité avant
qu'on généralise.

## Vérification
Comme toujours : dev server, actions réelles, captures d'écran des 3
écrans de référence avant/après. Confirmer que les tokens sont bien
centralisés (variables CSS réutilisées, pas de couleur en dur ajoutée
dans les composants touchés).
