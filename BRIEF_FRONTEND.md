# Brief — refonte frontend complète (packages/frontend)

## Contexte
Le frontend actuel est une seule page verticale avec ~10 blocs empilés
(identifiants, cycle, calculs, anomalies, conventions x2, taux historique,
audit, paramètres cabinet, paramètres dossier). Objectif : restructurer
en zones claires, moderniser le thème, ajouter un système de progression
sobre et professionnel. Rien ne change côté backend pour ce brief — tout
le nécessaire est déjà exposé par l'API.

## 1. Sélection de dossier (nouveau)
- `GET /dossiers?q=...` (header `x-cabinet-id`) : recherche par nom,
  retourne `{id, nom, siren, statut, regimeTva}[]`. Sans `q`, retourne
  tous les dossiers du cabinet.
- Écran d'entrée : champ de recherche + liste de résultats (nom, statut,
  régime TVA) → clic sélectionne le dossier et retient son id pour le
  reste de la session (remplace la saisie manuelle de l'UUID).

## 2. Point d'entrée "à traiter" (nouveau, avant tout le reste)
- `GET /dossiers/:id/a-traiter` : retourne un tableau d'éléments
  `{type, id, resume}` où `type` ∈ `anomalie_bloquante` /
  `convention_candidate` / `taux_candidate` / `taux_tiers_candidate` /
  `calcul_brouillon`.
- Dès qu'un dossier est sélectionné, avant même de lancer un cycle :
  afficher cette liste en évidence si elle n'est pas vide (bannière ou
  panneau en tête de page). Chaque élément doit permettre d'aller
  directement à l'écran concerné pour le traiter (router selon `type`).
- Si vide : rien à afficher, ou un état "rien en attente" discret.

## 3. Restructuration en 4 zones (au lieu de 10 blocs à plat)

**Zone "Cycle"** (vue par défaut une fois un dossier sélectionné)
Fusionne : formulaire de lancement de cycle + résultat du calcul +
anomalies de la période en cours + validation/rejet du calcul. Un seul
flux cohérent, pas trois panneaux à faire défiler.

**Zone "Configuration du dossier"**
Regroupe, en sous-onglets internes : Conventions de comptes (vente
service, charge service, équipement, carburant), Conventions génériques
(autoliquidation), Taux historique (compte produit/charge ET compte
client — même écran, filtrable). Visité rarement, pas besoin d'être sur
l'écran principal.

**Zone "Historique"**
Calculs passés (toutes périodes), anomalies passées (toutes périodes,
filtrables par type et statut), audit + export CSV.

**Zone "Paramètres"**, elle-même scindée en deux sous-sections distinctes
et clairement séparées visuellement :
- **Paramètres cabinet** (clé Mistral)
- **Paramètres dossier** (clé/valeur libre)
Ne pas les mélanger dans un seul formulaire — routes API déjà séparées
(`/parametres-cabinet` vs `/dossiers/:id/parametres`), garder cette
séparation visible côté utilisateur aussi. (L'authentification avec un
vrai mode admin/collaborateur n'est PAS dans ce brief — chantier séparé,
pas encore construit côté backend. Pour l'instant, les deux sections
restent accessibles sans distinction de rôle.)

## 4. Thème visuel
Passer d'un thème sombre à un thème clair (fond blanc/gris très clair),
avec une palette de couleurs secondaires moderne et sobre — pas de
couleurs criardes. Cohérence à travers toute l'application (badges de
statut, boutons, graphiques).

## 5. Animations et progression — sobre, professionnel, pas ludique

Recherche faite avant ce brief : pour un outil B2B utilisé par des
comptables, la gamification qui fonctionne évite l'esthétique "jeu".
Terminologie professionnelle ("jalon"/"progression" plutôt que
"XP"/"achievement"), icônes sobres (coche, étoile) plutôt que badges
cartoon, animations discrètes (transitions fluides) plutôt
qu'explosions/confettis, présentation par jauges/graphiques plutôt que
par interface de jeu.

**S'appuyer sur des données réelles déjà en base, pas des métriques
inventées :**
- Progression de confiance d'un tiers (`tiers_reference.niveau_confiance`
  + `nb_controles_sans_anomalie`) : jauge "nouveau → à surveiller →
  confiance", déjà trackée en base, jamais affichée aujourd'hui.
- Complétude de la configuration d'un dossier : % de comptes catégorisés,
  conventions confirmées vs en attente — jauge "dossier configuré à X%".
- Suite de cycles sans anomalie bloquante : indicateur simple type
  "dernier cycle sans blocage" plutôt qu'un "streak" façon jeu.
- Transitions de statut (anomalie résolue, calcul validé, encaissement
  qualifié) : micro-animation de confirmation discrète (pas de confettis),
  cohérente avec chaque action réussie dans l'app.

Éviter : leaderboards, compétition entre utilisateurs, points/score
globaux sans lien avec une donnée réelle, tout ce qui pourrait paraître
déplacé pour un outil de conformité fiscale utilisé par des professionnels.

## Vérification
Comme d'habitude : conditions réelles (dev server, actions réelles dans
le navigateur), pas juste au build. Vérifier en particulier que la
navigation entre les 4 zones ne perd pas le dossier sélectionné, et que
le point d'entrée "à traiter" reflète bien des données réelles du dossier
sandbox (pas un état vide par défaut alors qu'il y a des blocages).
