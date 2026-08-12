# Brief frontend v3

## 1. Description sous chaque onglet
Sous le titre de chaque onglet/sous-onglet, une phrase courte expliquant
son rôle. Textes proposés (à ajuster si besoin, l'important est le sens) :

- **Cycle** : "Lance un calcul de TVA sur une période, affiche le résultat
  et les anomalies à traiter pour ce cycle précis."
- **Configuration du dossier** : "Réglages fiscaux durables du dossier —
  s'appliquent à tous les cycles tant qu'ils ne sont pas modifiés."
  - **Conventions de comptes** : "Catégorise chaque compte de charge/produit
    en service, équipement, ou carburant — détermine si la TVA suit la règle
    du paiement (service) ou de la facturation (bien)."
  - **Conventions génériques** : "Réglages ponctuels sans catégorie dédiée —
    aujourd'hui, les comptes utilisés pour l'autoliquidation (prestations
    intracommunautaires)."
  - **Taux historique** : "Vérifie que le taux de TVA appliqué correspond à
    l'habitude du dossier — signale un écart, ne choisit rien à ta place."
  - **Taux assigné** (nouvel onglet, voir point 4) : "Attribue directement un
    taux de TVA à un compte ou un client, une fois pour toutes — utile pour
    un contrôle de cohérence en fin d'exercice, ou pour éviter d'attendre
    qu'un historique se constitue."
- **Historique** : "Calculs et anomalies de toutes les périodes passées,
  journal d'audit complet."
- **Paramètres** : "Réglages techniques — clé Mistral (cabinet), et
  décisions déjà validées modifiables (confiance des tiers, comptes retirés
  d'une convention, taux rejetés)."

## 2. Clarifier "Comptes de charge de service (sous-traitance)"
Source de confusion documentée (`GLOSSAIRE_PARAMETRES.md`) : ce nom laisse
penser à de l'autoliquidation, ce n'est pas le cas. Ajouter une info-bulle
(icône "?" ou survol) sur ce champ précisément :
"Tout achat de prestation de service, autoliquidé ou non — détermine si la
TVA déductible attend le paiement de la facture. Pour configurer les
comptes d'autoliquidation spécifiquement, voir l'onglet Conventions
génériques."

## 3. Anomalies — action groupée + filtre par type
- Menu déroulant "Filtrer par type" au-dessus de la liste (les 12 types
  possibles, cf. `CATALOGUE_ANOMALIES.md` pour les libellés lisibles à
  utiliser).
- Une fois filtré, bouton "Tout résoudre" (visible seulement si le filtre
  est actif, pour éviter un clic accidentel sur une liste non filtrée) —
  `POST /anomalies/resoudre-en-masse`, body
  `{anomalieIds, utilisateurId, commentaire}` où `anomalieIds` = les ids
  actuellement affichés après filtre. Commentaire obligatoire (un seul,
  partagé pour tout le lot).

## 4. Repositionner "Taux assigné" — pas dans Paramètres
Demande explicite de Rami (09/08) : ce réglage doit être facilement
accessible, pas enterré dans Paramètres dossier. Nouveau 4ᵉ sous-onglet
dans **Configuration du dossier**, à côté de Conventions de comptes /
Conventions génériques / Taux historique :

- **Produit/charge** : `GET/POST /dossiers/:id/taux-assignes`, body POST
  `{compte, taux, utilisateurId}`. `taux` ∈ `'0'`, `'2.1'`, `'5.5'`, `'10'`,
  `'20'`, `'autoliquide_intracom'`, `'autoliquide_20'`, `'autoliquide_10'`,
  `'autoliquide_5.5'`.
- **Client** : `POST /dossiers/:id/taux-historique-tiers/assigner`, body
  `{numeroCompteTiers, tauxHabituel, utilisateurId}` — assignation directe,
  distincte de la détection automatique sur historique (qui reste dans
  l'onglet Taux historique, candidate/confirmed).

Retirer la section correspondante de Paramètres dossier si elle a déjà été
construite dans un tour précédent (elle a été demandée là initialement,
puis Rami a changé d'avis sur l'emplacement).

## 5. Police
Remplacer par Montserrat ou Poppins (auto-hébergée comme Inter
actuellement, pas de dépendance réseau).

## Contexte : deux bugs corrigés côté backend, rien à faire côté frontend
Pour information seulement — deux comportements changent silencieusement :
- Le popup de catégorisation ne proposera plus de comptes de trésorerie
  (5121 etc.) — filtré aux classes 2/6/7 uniquement.
- L'onglet Taux historique ne proposera plus de candidates sur les comptes
  déductibles (44566/44562) — seule la collecte (445711-445714) en génère
  désormais, ces comptes étant trop souvent mixtes pour qu'un "taux
  habituel" ait un sens.

## Vérification
Comme toujours : dev server, actions réelles, pas juste au build.
