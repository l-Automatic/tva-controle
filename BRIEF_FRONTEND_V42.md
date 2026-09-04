# Brief frontend v42 — nouveau_tiers_a_verifier : valider / ignorer

## Contexte
Deux boutons, remplacent Résoudre/Justifier pour ce type précis —
`POST /anomalies/:id/qualifier-nouveau-tiers` avec
`{utilisateurId, type: 'valide'|'ignore'}`. Ne touche jamais le calcul
(anomalie purement informative), mais les deux boutons n'ont pas le même
effet dans le temps :

- **"Valider le tiers"** (`type: 'valide'`) → ce tiers ne sera plus
  jamais signalé comme nouveau, sur aucun cycle futur.
- **"Ignorer"** (`type: 'ignore'`) → résout seulement cette occurrence
  précise. Ce même tiers réapparaîtra comme "nouveau tiers à vérifier"
  au prochain cycle qui le touche — c'est voulu, pas un bug : rien n'a
  été vraiment tranché, donc rien n'est mémorisé.

## Ce qu'il faut faire
Sur `AnomaliesPanel.tsx`, ajouter ces deux boutons pour ce type
d'anomalie, à la place de Résoudre/Justifier. Un libellé clair pour
"Ignorer" serait utile pour que le collaborateur comprenne qu'il reverra
cette même anomalie plus tard si rien n'est corrigé — par exemple une
info-bulle ou un texte secondaire du type "reviendra au prochain cycle
si rien ne change".

## Vérification
Comme toujours : dev server, actions réelles. Qualifier une anomalie
réelle en "Valider", relancer un cycle sur une période où ce même tiers
réapparaît, vérifier qu'elle ne se signale plus. Qualifier une autre
anomalie en "Ignorer", relancer un cycle, vérifier qu'elle revient.
