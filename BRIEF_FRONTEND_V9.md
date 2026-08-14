# Brief frontend v9 — relance complète de v6, jamais appliqué

## Contexte
`BRIEF_FRONTEND_V6.md` n'a jamais été exécuté (confirmé le 10/08 : cadeaux
clients absent du popup et de Conventions de comptes). Ce brief reprend
tout son contenu, plus un ajout du 10/08.

## 1. Écran de gestion du parc de véhicules
Dans **Configuration du dossier** :
- `GET /dossiers/:id/vehicules` — liste (id, désignation, type, montant HT,
  date d'acquisition, statut).
- `POST /dossiers/:id/vehicules` — ajout, body
  `{designation?, typeBien: 'vehicule_tourisme'|'vehicule_utilitaire'|'autre', montantHt?, dateAcquisition?, utilisateurId}`.
- `POST /vehicules/:id/retirer` — retrait, body `{utilisateurId}`.
- Formulaire simple : désignation (texte libre), type (select 3 options),
  montant HT et date optionnels. Confirmé immédiatement, pas de
  candidate/confirmed.

## 2. Cadeaux clients — 5ᵉ catégorie du popup et de Conventions de comptes
Le popup de catégorisation et l'onglet Conventions de comptes doivent
proposer 5 choix au lieu de 4 : Prestation de service, Compte
d'équipement, Carburant, **Cadeaux clients**, Aucune de celles-là. Même
route existante (`POST /dossiers/:id/conventions`) avec
`cle: 'comptes_cadeaux'`.

## 3. NOUVEAU (10/08) — 6ᵉ catégorie : Comptes d'immobilisations
S'ajoute aux 5 précédentes, dans le popup ET l'onglet Conventions de
comptes : **Compte d'immobilisation**, `cle: 'comptes_immobilisation'`.
Sert à un contrôle bloquant : si une pièce touche un compte confirmé dans
cette catégorie mais que sa TVA déductible est en 44566 au lieu de 44562,
c'est signalé comme une erreur de saisie à corriger.

## 4. Régime TVA sur encaissement — paramètre dossier
Dans **Paramètres dossier**, select à 3 options : "Prestations de service
(TVA à l'encaissement)" / "Vente de biens ou encaissement comptant (TVA à
la facturation)" / "Mixte (par défaut prudent)" — clé
`regime_tva_encaissement`, valeurs `service`/`bien`/`mixte`. Route
`POST /dossiers/:id/parametres`, body
`{cle: 'regime_tva_encaissement', valeur, utilisateurId}`. Explication
courte sous le select : "Détermine si un encaissement client sans facture
rapprochée doit générer de la TVA collectée par défaut. Un commerce avec
caisse ou vente comptant doit choisir 'biens'."

## Vérification
Comme toujours : dev server, actions réelles. Vérifier explicitement,
avant de clore, que les 6 catégories apparaissent bien ensemble dans le
même popup et le même onglet — pas seulement 5 ou 4.
