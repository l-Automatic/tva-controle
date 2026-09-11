# Brief frontend v75 — audit et correction des formats français dans toute l'app

## Demande de Rami
Toutes les dates affichées dans l'application doivent être au format
français JJ/MM/AAAA — jamais un format américain (MM/DD/YYYY) ni une
date ISO brute (YYYY-MM-DD) affichée telle quelle à l'écran. Au-delà
des dates, chercher et corriger tout autre élément qui suivrait une
convention américaine plutôt que française.

## Ce qu'il faut auditer et corriger

### 1. Dates
Chercher systématiquement, dans tout le code frontend :
- Tout rendu de date qui n'utilise pas explicitement le format
  français (ex: `toLocaleDateString()` sans `'fr-FR'`, une date ISO
  affichée brute sans reformattage, un format construit à la main en
  MM/DD/YYYY).
- Les champs de saisie de date (`<input type="date">` ou équivalents)
  — vérifier que l'affichage à l'utilisateur reste cohérent avec le
  reste de l'app même si le type HTML natif a ses propres contraintes
  de saisie.

Corriger partout en JJ/MM/AAAA, de façon cohérente dans toute l'app —
idéalement via une seule fonction/utilitaire de formatage réutilisé
partout, pas un correctif au cas par cas dans chaque composant, pour
éviter que ça se reproduise ailleurs plus tard.

### 2. Autres conventions américaines à vérifier
- **Nombres et montants** : la France utilise la virgule comme
  séparateur décimal et l'espace comme séparateur de milliers (ex:
  "1 234,56 €"), jamais le point décimal ni la virgule comme
  séparateur de milliers à l'américaine ("1,234.56"). Vérifier que
  tous les montants affichés (TVA, totaux, soldes...) suivent bien
  cette convention.
- **Position du symbole monétaire** : en France, le symbole € se met
  après le montant ("1 234,56 €"), pas avant comme le "$" américain.
- Tout autre format américain repéré en cours d'audit (heures,
  unités, etc.) — à signaler même si non explicitement listé ici.

## Ce qui est demandé
Faire l'inventaire complet d'abord (lister les endroits concernés),
puis corriger de façon cohérente dans toute l'application. Rapporter
précisément ce qui a été trouvé et corrigé, y compris si quelque chose
en dehors des dates/nombres a été repéré.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer visuellement
qu'une date affichée quelque part dans l'app (peu importe l'écran) est
bien en JJ/MM/AAAA, et qu'un montant est bien affiché à la française.
