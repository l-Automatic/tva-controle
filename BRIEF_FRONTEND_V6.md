# Brief frontend v6

## 1. Vérifier/relancer BRIEF_FRONTEND_V4.md
Aucune confirmation n'a été reçue que ce brief a été exécuté — vérifier
l'état actuel de l'interface contre chacun de ses points, et appliquer ce
qui manque encore : retrait de "(sous-traitance)", renommage de la
section Taux historique, formulaire "Ajouter" dans Conventions génériques,
suggestions de comptes dans Taux assigné, libellés lisibles pour les
valeurs de taux.

## 2. Vérifier la redondance CycleForm/AnomaliesPanel
Vérification active demandée (pas une supposition) : les anomalies de la
période apparaissent-elles à un seul endroit dans la zone "Cycle", ou
encore en double quelque part ?

## 3. Écran de gestion du parc de véhicules
Nouveau, dans **Configuration du dossier** (aux côtés des autres écrans de
configuration fiscale) :
- `GET /dossiers/:id/vehicules` — liste (id, désignation, type, montant HT,
  date d'acquisition, statut).
- `POST /dossiers/:id/vehicules` — ajout, body
  `{designation?, typeBien: 'vehicule_tourisme'|'vehicule_utilitaire'|'autre', montantHt?, dateAcquisition?, utilisateurId}`.
- `POST /vehicules/:id/retirer` — retrait, body `{utilisateurId}`.
- Formulaire simple : désignation (texte libre), type (select 3 options),
  montant HT et date optionnels. Confirmé immédiatement, pas de
  candidate/confirmed.

## 4. Cadeaux clients — 5ᵉ catégorie
Le popup de catégorisation des comptes (déjà existant) doit maintenant
proposer 5 choix au lieu de 4 : Prestation de service, Compte
d'équipement, Carburant, **Cadeaux clients** (nouveau), Aucune de
celles-là. Utilise la même route existante
(`POST /dossiers/:id/conventions`) avec `cle: 'comptes_cadeaux'`. Le
résultat d'un cycle expose maintenant aussi les comptes déjà catégorisés
en cadeaux dans la détection du popup (rien à changer côté appel, juste la
5ᵉ option à afficher).

## 5. Régime TVA sur encaissement — nouveau paramètre dossier
Dans **Paramètres dossier**, ajouter un select à 3 options :
"Prestations de service (TVA à l'encaissement)" / "Vente de biens ou
encaissement comptant (TVA à la facturation)" / "Mixte (par défaut
prudent)" — clé `regime_tva_encaissement`, valeurs `service`/`bien`/
`mixte`. Utilise la route déjà existante `POST /dossiers/:id/parametres`
(body `{cle: 'regime_tva_encaissement', valeur, utilisateurId}`). Ajouter
une explication courte sous le select : "Détermine si un encaissement
client sans facture rapprochée doit générer de la TVA collectée par
défaut. Un commerce avec caisse ou vente comptant doit choisir 'biens'."

## Vérification
Comme toujours : dev server, actions réelles, pas juste au build. En
particulier, confirmer que le brief v4 est bien passé cette fois-ci avant
de clore ce tour.
