# Brief frontend v46 — brief groupé (audit contrôles TVA du 10/08)

Six sujets accumulés depuis le dernier brief, tous liés à l'audit
systématique des contrôles TVA. À traiter ensemble.

## 1. Cinq types d'anomalies à ajouter au menu déroulant

Ces cinq types sont actifs dans le cycle réel depuis longtemps pour
certains, aujourd'hui pour d'autres — mais **absents du menu déroulant
de filtrage** (Cycle et Historique). À ajouter :

- `autoliquidation_desequilibree` (bloquant)
- `autoliquidation_incomplete` (bloquant)
- `immobilisation_sur_compte_tva_incorrect` (bloquant)
- `incoherence_taux_autoliquidation` (signalé)
- `incoherence_taux_produit` (bloquant, nouveau — compare le taux
  implicite d'une écriture au taux dominant du compte **produit**
  associé, pas du compte de TVA collectée)

Note : `tva_sur_livraison_intracom_exoneree` existe dans le code mais
reste volontairement hors périmètre — décision explicite, ne pas
l'ajouter au menu déroulant.

## 2. Écran dédié "comptes TVA à confirmer" — nouvelle porte obligatoire (4e)

`GET /dossiers/:dossierId/comptes-tva-a-confirmer?periodeDebut&periodeFin`
retourne les comptes de la famille TVA (445xx) avec du mouvement mais
jamais confirmés (dû/déductible, BTP et intracom). Comme pour la
catégorisation, un écran dédié avec ces comptes pré-remplis, et pour
chacun un choix parmi : "compte TVA due autoliquidée (BTP)", "compte
TVA déductible autoliquidée (BTP)", "compte TVA due autoliquidée
(intracom)", "compte TVA déductible autoliquidée (intracom)". Écriture
via la route générique déjà existante
`POST /dossiers/:dossierId/conventions` avec les clés
`compte_tva_due_autoliquidee`, `compte_tva_deductible_autoliquidee`,
`compte_tva_due_autoliquidee_intracom`,
`compte_tva_deductible_autoliquidee_intracom`.

Cette porte bloque désormais le lancement d'un cycle
(`POST /dossiers/:dossierId/cycles` renvoie 409 avec
`comptesTvaAConfirmer` si des comptes restent à confirmer) — rediriger
vers cet écran en cas de 409.

## 3. Extension de la porte de catégorisation — deuxième motif de blocage

`GET /dossiers/:dossierId/comptes-a-categoriser` retourne maintenant un
objet à deux champs au lieu d'un tableau :
`{comptesACategoriser, comptesServiceSansSousCategorieAutoliquidation}`.
Le popup de catégorisation existant doit maintenant aussi présenter les
comptes du second champ, avec un choix : "lié à l'autoliquidation
(sous-traitance)" ou "non lié". Écriture via la même route générique de
conventions, clés `comptes_charge_autoliquidation` et
`comptes_charge_autoliquidation_rejetee`.

Le 409 de `POST /dossiers/:dossierId/cycles` peut désormais contenir
`comptesServiceSansSousCategorieAutoliquidation` en plus de
`comptesACategoriser` — les deux doivent rediriger vers le même écran.

## 4. Boutons "Vérifier à nouveau" — quatre nouvelles routes, même principe partout

Chacune : un seul bouton, pas de qualification préalable (erreurs de
saisie certaines ou déductions statistiques, jamais une question à
trancher), aucun ajustement du calcul. Réponse `{anomaliesOuvertes: number}`.

- `POST /dossiers/:dossierId/verifier-autoliquidation` — couvre
  `autoliquidation_desequilibree` ET `autoliquidation_incomplete` en un
  seul appel
- `POST /dossiers/:dossierId/verifier-immobilisation-tva` — pour
  `immobilisation_sur_compte_tva_incorrect`
- `POST /dossiers/:dossierId/verifier-taux-produit` — pour
  `incoherence_taux_produit`
- `POST /dossiers/:dossierId/verifier-coherence-taux-autoliquidation` —
  pour `incoherence_taux_autoliquidation`

## Vérification
Comme toujours : dev server, actions réelles. Pour chaque nouveau type
d'anomalie, vérifier qu'il apparaît bien dans le filtre des deux
onglets. Provoquer les deux nouvelles portes réellement (dossier sans
comptes TVA confirmés, dossier avec charge autoliquidation non
sous-catégorisée) et vérifier la redirection vers les bons écrans.
Tester chaque bouton "Vérifier à nouveau" avant et après correction
réelle côté Pennylane.
