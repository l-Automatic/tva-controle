# Brief frontend v27 — jeton cabinet Pennylane et synchronisation des dossiers

## Contexte
Backend prêt (chantier API Cabinet, phase 1) : le jeton Pennylane n'est
plus jamais fourni manuellement pour lancer un cycle — il vient d'un
paramètre cabinet, et le dossier ciblé de son propre identifiant Pennylane
stocké. Trois choses à faire côté interface.

## 1. Nouveau champ dans Paramètres du cabinet (admin_cabinet uniquement)
Un champ pour le jeton d'API Cabinet Pennylane, à côté de la clé Mistral
déjà présente. Écrit via la route déjà existante
`PUT /parametres-cabinet` avec `cle: 'pennylane_firm_api_key'`. Comme pour
la clé Mistral, ne jamais afficher la vraie valeur une fois enregistrée
(le backend la masque déjà, `••••••••`).

## 2. Bouton "Synchroniser les dossiers" (admin_cabinet uniquement)
Quelque part visible dans Paramètres du cabinet ou dans la liste des
dossiers. Appelle `POST /synchroniser-dossiers` (aucun corps de requête
nécessaire). Réponse : `{total, nouveaux, dossiers: [{id, nom, nouveau}]}`.

Après l'appel, afficher un résumé clair ("12 dossiers synchronisés, 3
nouveaux") et idéalement rafraîchir la liste des dossiers affichée
ailleurs dans l'application pour que les nouveaux apparaissent
immédiatement.

Si l'appel échoue avec un 400 (jeton cabinet non configuré), afficher le
message renvoyé par le backend tel quel — il explique déjà clairement quoi
faire.

## 3. Retirer les champs "Token Pennylane" devenus inutiles
Deux endroits où un champ de saisie manuelle du jeton Pennylane existe
encore, mais que le backend n'attend plus dans le corps de la requête (il
est ignoré silencieusement s'il est quand même envoyé) :
- Le déclenchement d'un cycle (section Cycle).
- L'analyse du motif de numérotation (section Configuration du dossier >
  Conventions génériques).

Retirer ces deux champs de saisie — plus rien à demander à l'utilisateur à
cet endroit, le jeton vient maintenant automatiquement du cabinet.

## Vérification
Comme toujours : dev server, actions réelles. Enregistrer un jeton cabinet
(même une valeur de test si le vrai jeton n'est pas encore disponible),
vérifier qu'il est bien masqué après enregistrement. Lancer une
synchronisation et vérifier le résumé affiché. Confirmer que les deux
anciens champs de jeton Pennylane manuel ont bien disparu, et qu'un cycle
peut toujours être lancé sans eux (même si l'appel réseau réel à Pennylane
échoue faute d'un vrai jeton cabinet configuré — c'est un problème de
configuration à part, pas de l'interface).
