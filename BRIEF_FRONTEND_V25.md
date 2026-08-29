# Brief frontend v25 — authentification complète

## Contexte
Backend prêt : connexion, jetons signés, deux rôles (`collaborateur`,
`admin_cabinet`). Chantier conséquent — touche toute l'application, pas
juste un écran en plus.

## 1. Écran de connexion
Formulaire email + mot de passe. Appelle `POST /auth/login` avec
`{email, motDePasse}`. Réponse en cas de succès :
`{jeton: string, utilisateur: {id, cabinetId, role}}`. Stocker le jeton ET
l'objet utilisateur (le rôle sert à adapter l'interface, cf. point 4).

En cas d'échec (401), un seul message générique ("Identifiants
invalides.") — le backend ne distingue jamais email inconnu de mot de
passe incorrect, l'interface ne doit pas recréer cette distinction non
plus.

## 2. Remplacer l'ancien en-tête partout
Chaque appel API envoyait jusqu'ici `x-cabinet-id: <cabinetId>`. Ce
mécanisme n'existe plus côté backend — remplacer partout par
`Authorization: Bearer <jeton>`. Le cabinet n'est plus à fournir
explicitement, il vient du jeton côté serveur.

## 3. Session
- Stocker le jeton (localStorage, simple).
- Sur toute réponse 401 d'un appel API (jeton absent, invalide ou
  expiré — le jeton dure 12h, pas de renouvellement automatique dans
  cette v1) : effacer la session stockée et rediriger vers l'écran de
  connexion.
- Un bouton de déconnexion, quelque part visible en permanence (en-tête
  de l'application par exemple) : efface la session stockée, retour à
  l'écran de connexion.

## 4. Masquer les paramètres cabinet pour un collaborateur
Le rôle `collaborateur` n'a plus accès à `GET /parametres-cabinet` ni
`PUT /parametres-cabinet` côté backend (403 si tenté). Chercher où cette
route est utilisée côté interface (probablement une section "Paramètres
du cabinet" ou similaire, distincte de "Configuration du dossier" qui
reste accessible aux deux rôles) et la masquer entièrement pour un
utilisateur au rôle `collaborateur` — pas juste désactiver les champs,
ne pas l'afficher du tout.

## 5. Nouvel écran — Gestion des utilisateurs (admin_cabinet uniquement)
Nouvelle section, visible seulement pour le rôle `admin_cabinet` (masquée
entièrement pour un collaborateur, même logique qu'au point 4) :

- **Liste** : `GET /utilisateurs` → `[{id, nom, email, role, statut,
  aUnMotDePasse}]`. Afficher nom, email, rôle ; signaler visuellement un
  utilisateur avec `aUnMotDePasse: false` (n'a jamais pu se connecter).
- **Ajouter un utilisateur** : formulaire nom / email / rôle (select
  collaborateur / admin_cabinet) / mot de passe initial (au moins 8
  caractères). Appelle `POST /utilisateurs`. Si l'email existe déjà,
  le backend répond 409 — afficher l'erreur clairement.
- **Réinitialiser le mot de passe** d'un utilisateur existant : bouton
  sur chaque ligne, ouvre un petit formulaire (nouveau mot de passe, au
  moins 8 caractères), appelle
  `POST /utilisateurs/:id/mot-de-passe`.

## Vérification
Comme toujours : dev server, actions réelles. Se connecter avec un vrai
compte, vérifier que toutes les pages existantes continuent de fonctionner
avec le nouveau mécanisme (plus aucun appel ne doit encore envoyer
l'ancien en-tête). Tester la déconnexion, un jeton invalide forcé (ex:
altérer le jeton stocké dans le navigateur) redirige bien vers la
connexion. Vérifier le masquage des paramètres cabinet et de la gestion
des utilisateurs pour un compte collaborateur. Créer un nouvel
utilisateur depuis l'interface et vérifier qu'il peut se connecter avec
le mot de passe défini.
