# Brief frontend v82 — corrige l'ombre pulsée et applique réellement le nouveau système aux anomalies

## 1. Ombre pulsée bien trop intense

Retour de Rami avec capture d'écran : l'ombre pulsée actuelle est
beaucoup trop forte, elle écrase la lisibilité de la carte en dessous.

**À corriger** : revenir exactement au réglage de couleur/intensité du
v80 (celui que Claude Code avait ajusté pour corriger l'effet
"rembobinage" et intensifier légèrement) — PAS le réglage actuel du
v81, qui est allé trop loin. Une fois revenu au niveau du v80,
augmenter très légèrement à partir de là seulement, pas une
refonte complète de l'intensité.

## 2. Les cartes d'anomalies n'ont presque pas changé

Le v81 n'a touché que le contour et l'ombre pulsée sur cet écran —
pas les pastilles (toujours l'ancien orange terne, jamais remplacées
par les nouveaux tokens `--alerte-500`/`--danger-500`), pas la
typographie (toujours l'ancienne police, pas les tokens H3/Corps/
Légende du v81), pas les blocs d'info (toujours les cadres gris avec
labels en majuscules de l'ancien style, jamais retravaillés avec les
nouveaux tokens de rayon/couleur).

**Ce qui est demandé cette fois, explicitement sur CETTE carte** :
- Les deux pastilles (statut + gravité) : nouvelle typographie (celle
  définie au v81 — même famille que le reste du nouveau système),
  couleurs `--alerte-500`/`--danger-500` (ou leurs teintes 50/100 en
  fond de pastille, texte en 900), pas l'ancien orange.
- Les blocs d'info (compte, montant, confiance IA, justification...) :
  reprendre le style de carte du nouveau système — rayon cohérent,
  fond `--neutre-50`, labels en légende (12px/400/`--neutre-500`),
  contenu en corps de texte (14px/400) — pas les cadres gris à
  bordure actuelle avec labels en majuscules.
- Le titre de l'anomalie (ex: "TVA hôtel à vérifier") : typographie H3
  du nouveau système.
- Les boutons (Ok/Ignorer, Confirmer/Ignorer, etc.) : déjà partiellement
  mis à jour au v81 pour un autre écran — appliquer le même traitement
  ici.

## Vérification
Comme toujours : dev server, actions réelles, captures avant/après.
Confirmer que l'ombre pulsée est revenue à une intensité raisonnable
(niveau v80 + légère augmentation). Confirmer visuellement que la
carte d'anomalie entière (pastilles, titre, blocs, boutons) utilise
maintenant le nouveau système de design, pas seulement le contour.
