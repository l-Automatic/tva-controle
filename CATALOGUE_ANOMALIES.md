# Catalogue des anomalies — tout ce que le logiciel peut signaler

> Chaque anomalie a un `type` (identifiant technique, visible dans les
> détails bruts), une `gravite` (`bloquant` = arrête le calcul tant que ce
> n'est pas traité manuellement ; `signale` = n'empêche rien, juste une
> alerte à vérifier), et un déclencheur précis. 12 types existent
> aujourd'hui, listés dans l'ordre où ils apparaissent dans un cycle.
>
> **Retirées le 10/08** après audit avec Rami : `ligne_tiers_introuvable`
> (en réalité une vente comptant sans compte client, jamais une vraie
> anomalie — exigible silencieusement désormais) et `flotte_mixte_carburant`
> (cas jugé quasi inexistant en pratique — un dossier avec un utilitaire
> n'a aucun intérêt à immobiliser aussi un véhicule de tourisme ; si ça
> arrive quand même, déduit à 100% sans réduction ni signalement).

## Bloquantes (arrêtent le calcul)

### `compte_tva_non_reconnu`
**Déclencheur** : un compte de la famille TVA (445*, 4454) a du mouvement
sur la période, mais n'est reconnu par aucun mécanisme du logiciel — ni
collecte (445711-445714), ni déductible standard (44566/44562), ni
autoliquidation (comptes configurés dans les conventions).
**Pourquoi bloquant** : ça peut cacher un cas hors périmètre (le plus
probable : de la TVA intracommunautaire, non traitée par ce logiciel) —
jamais ignoré silencieusement.
**Action attendue** : vérifier manuellement de quoi il s'agit ; si c'est
un cas géré mal configuré, ajouter le compte à la bonne convention.

### `encaissement_non_affecte`
**Déclencheur** : un encaissement (ligne créditrice) sur un compte
d'attente (471 par défaut, paramétrable) qui n'est pas lettré — donc
jamais rapproché d'une facture, d'un acompte ou d'une régularisation.
**Pourquoi bloquant** : de la TVA peut être due sur cet argent reçu, sans
qu'on sache encore si c'est le cas.
**Action attendue** : qualifier — "lié à une vente" (choisir un taux) ou
"sans lien avec une vente" (motif obligatoire, ex : remboursement
d'assurance).

## Signalées (n'empêchent rien, à vérifier)

### `nature_operation_indeterminee`
**Déclencheur** : une écriture de TVA collectée n'a aucune ligne produit
associée sur la même pièce — impossible de savoir si c'est un bien ou un
service.
**Action attendue** : vérifier la pièce dans Pennylane ; par défaut, le
calcul traite quand même la ligne comme exigible (prudence côté collecte).

### `nature_operation_mixte`
**Déclencheur** : une même pièce de TVA collectée mêle des lignes
produits de nature différente (certaines "bien", certaines "service").
**Action attendue** : vérifier ligne par ligne dans Pennylane — le calcul
ne peut pas trancher automatiquement lequel s'applique.

### `paiement_partiel_a_verifier`
**Déclencheur** : sur une vente de service, la ligne client est lettrée,
mais son groupe de lettrage contient plus de 2 lignes, **et** les montants
du groupe n'ont pas pu être récupérés ou interprétés (cas rare — sinon
voir `paiement_partiel_calcule` ci-dessous, qui couvre maintenant la
majorité des cas depuis le 10/08).
**Action attendue** : vérifier manuellement le détail du groupe dans
Pennylane.

### `paiement_partiel_calcule`
**Déclencheur** : groupe de lettrage à plus de 2 lignes, mais le prorata a
pu être établi — **ventes** : calcul purement arithmétique sur les
montants du groupe (total encaissé / total facturé), toujours tenté.
**Achats** : uniquement si un LLM (Mistral) a d'abord établi, avec une
confiance suffisante, qu'il s'agit bien d'un acompte rattaché à une
facture précise et identifiable — sans clé Mistral configurée, ou sans
lien établi avec confiance, ce type n'apparaît jamais côté achats et
l'écriture reste exclue par prudence (cf. `paiement_partiel_a_verifier`
ou l'exclusion silencieuse selon le cas).
**Pourquoi "info", pas "signalée"** : ce n'est plus une incertitude à
vérifier, c'est un résultat calculé — informatif, pour que le
collaborateur voie que ce cas a été traité automatiquement.
**Action attendue** : aucune par défaut ; vérifier seulement si le prorata
affiché semble incohérent avec ce que vous savez du dossier.

### `avoir_a_verifier`
**Déclencheur** : un débit apparaît sur un compte de TVA collectée — un
compte de TVA collectée est normalement toujours au crédit (une vente),
donc un débit signifie presque toujours un avoir client ou une écriture
de régularisation.
**Action attendue** : confirmer que c'est bien un avoir ou une
régularisation légitime (le calcul le traite déjà correctement en
soustraction, cf. bug corrigé le 02/08 — ce n'est qu'une vérification,
pas un signe que le calcul est faux).

### `parc_vehicules_non_renseigne`
**Déclencheur** : un achat de carburant (compte configuré dans
`comptes_carburant`) existe sur la période, mais aucun véhicule n'est
répertorié dans les immobilisations du dossier — impossible de savoir si
la déductibilité doit être 80% (tourisme) ou 100% (utilitaire).
**Action attendue** : renseigner le parc de véhicules du dossier
(actuellement : ajout manuel dans les immobilisations Pennylane, aucun
paramétrage dédié dans ce logiciel pour l'instant).

### `immobilisation_potentielle_non_passee`
**Déclencheur** : une ligne (ou plusieurs sur la même pièce) sur un
compte de "petit équipement" configuré (`comptes_equipement`, ex : 6063)
dépasse un seuil (500€ HT par défaut, paramétrable) — signe possible
qu'un achat aurait dû être immobilisé plutôt que passé en charge directe.
**Action attendue** : vérifier si un passage en immobilisation est
nécessaire (décision comptable, jamais automatisée).

### `nouveau_tiers_a_verifier`
**Déclencheur** : un compte client ou fournisseur (401/411) apparaît sur
une écriture de la période, mais n'a jamais été vu lors d'un cycle
précédent pour ce dossier (`tiers_reference` ne le connaît pas).
**Pourquoi ça compte** : protection contre la fraude à la TVA par facture
de complaisance (faux fournisseur). Le jugement de risque réel (est-ce
suspect ?) reste entièrement humain — le logiciel signale juste "jamais
vu", rien de plus.
**Action attendue** : vérifier que le tiers existe réellement. Une fois
confirmé plusieurs fois sans souci, la confiance progresse automatiquement
(nouveau → à surveiller après 3 cycles → confiance après 6 cycles).

### `encaissement_client_taux_applique`
**Déclencheur** : un encaissement (ligne créditrice) sur un compte client
précis (411xxx) n'est pas lettré — aucune facture rapprochée. Contrairement
au 471, **le calcul n'attend pas de qualification** : un taux est appliqué
directement (le taux historique du client s'il est connu, sinon 20% par
prudence), et cette anomalie trace la décision prise.
**Action attendue** : vérifier que le taux appliqué est le bon. Pas encore
construit : un moyen de corriger ce taux pour cette écriture précise si le
défaut ne convient pas (voir `REGLES_FISCALES_ET_TACHES.md`, Groupe C).

### `immobilisation_vehicule_tourisme_a_verifier`
**Déclencheur** : une ligne de TVA déductible sur immobilisation (44562)
existe, et le dossier a au moins un véhicule de tourisme confirmé dans son
parc de véhicules.
**Pourquoi signalée, pas bloquante** : impossible de lier de façon fiable
une ligne d'immobilisation précise à un véhicule précis (surtout pour un
véhicule ajouté manuellement, sans référence vers une écriture source).
**Action attendue** : vérifier si cette écriture précise concerne le
véhicule de tourisme (0% déductible) ou un autre bien (déductible
normalement).

### `incoherence_taux_autoliquidation`
**Déclencheur** : le taux implicite (TVA/HT) d'une écriture sur le compte
de charge spécifiquement identifié comme lié à l'autoliquidation
(via co-occurrence avec la ligne 445664 confirmée) s'écarte du taux
dominant observé pour ce même compte sur la période.
**Action attendue** : vérifier une possible erreur de saisie.

### `immobilisation_sur_compte_tva_incorrect`
**Déclencheur** : une pièce touche un compte confirmé dans la catégorie
"Comptes d'immobilisation", mais sa TVA déductible est passée en 44566
(autres biens et services) au lieu de 44562 (immobilisations).
**Pourquoi bloquante** : contrairement à la plupart des contrôles de ce
module, c'est une erreur de saisie certaine, pas une nuance d'appréciation.
**Action attendue** : corriger le compte de TVA dans Pennylane, puis
relancer le cycle.

### `autoliquidation_incomplete`
**Déclencheur** : le nombre de pièces distinctes touchant le(s) compte(s)
de charge confirmés comme liés à l'autoliquidation ne correspond pas au
nombre de pièces touchant 4454 (TVA due) et 445664 (TVA déductible) sur
la même période.
**Pourquoi bloquante** : signale un oubli probable de l'écriture
d'autoliquidation, un vrai manquement de conformité.
**Action attendue** : vérifier et compléter l'écriture manquante dans
Pennylane.

### `tva_hotel_a_tort`
**Déclencheur** : une ligne de TVA déductible (44566) existe sur une pièce
dont le fournisseur est identifié comme un hôtel — par le **nom officiel du
compte fournisseur** (ex: "401HOTEL", libellé "HOTELS"), jamais un libellé
d'écriture.
**Pourquoi bloquante** : la TVA sur les frais d'hébergement n'est jamais
déductible — si elle apparaît quand même, c'est une erreur de saisie
certaine, pas une nuance d'appréciation.
**Action attendue** : corriger l'écriture dans Pennylane (retirer la TVA),
puis relancer le cycle.

### `tva_hotel_a_verifier`
**Déclencheur** : extension du contrôle précédent, pour un fournisseur
générique ("fournisseurs divers") dont le nom de compte ne mentionne pas
"hôtel" — le LLM (Mistral) juge, à partir du seul libellé de l'écriture
(ex : "IBIS PARIS 12/01"), s'il ressemble à une nuit d'hôtel.
**Pourquoi signalée, pas bloquante** : contrairement au contrôle
déterministe ci-dessus, un jugement IA sur un nom de marque peut se
tromper (faux positif) — jamais utilisé pour bloquer un cycle seul.
**Action attendue** : vérifier manuellement s'il s'agit bien d'un hôtel et,
si oui, corriger l'écriture.

### `trou_numerotation_facture`
**Déclencheur** : au moins un numéro de facture semble manquer dans la
séquence des ventes, selon un motif de numérotation préalablement confirmé
(ex : "FA-2025-001" suivi de "FA-2025-003" sans "FA-2025-002").
**Pourquoi jamais bloquante** : un trou informe le travail de contrôle, il
n'empêche jamais le calcul de TVA — décision explicite reprise depuis la
toute première conversation du projet.
**Prérequis** : un motif doit avoir été confirmé au préalable (déclenché
manuellement via un bouton dédié, jamais automatique à chaque cycle) — sans
motif confirmé, ce contrôle ne fait rien du tout.
**Action attendue** : vérifier si une facture a été omise de la
comptabilité, ou si le numéro a été sauté volontairement (annulation,
avoir...).

### `doublon_numerotation_facture`
**Déclencheur** : le même numéro de facture (selon le motif confirmé)
apparaît sur plusieurs pièces distinctes.
**Pourquoi jamais bloquante** : même principe que le trou — informe le
travail de contrôle, n'empêche jamais le calcul.
**Prérequis** : identique au trou — nécessite un motif confirmé au
préalable.
**Action attendue** : vérifier s'il s'agit d'une vraie facture dupliquée
par erreur, ou d'une réutilisation de numéro à corriger.

---

## Ce que "Résoudre" et "Justifier" veulent dire, dans l'interface

Ces deux actions génériques s'appliquent à la plupart des anomalies
ci-dessus (sauf les deux qui ont leur propre mécanisme dédié :
`encaissement_non_affecte` se qualifie, ne se résout/justifie pas
directement ; `encaissement_client_taux_applique` n'a actuellement aucune
action de correction).

- **Résoudre** : "j'ai réglé le problème sous-jacent" — par exemple,
  j'ai ajouté le compte manquant dans les conventions, ou corrigé une
  erreur de saisie dans Pennylane. Nécessite un commentaire expliquant ce
  qui a été fait.
- **Justifier** : "ce n'est pas un problème, c'est normal dans ce cas
  précis" — par exemple, l'avoir signalé est bien un vrai avoir, rien à
  corriger. Nécessite un commentaire expliquant pourquoi.

Dans les deux cas, l'anomalie change de statut et sort de la liste par
défaut (reste consultable via "Afficher les anomalies traitées"), mais
**aucune des deux n'a d'impact sur le calcul lui-même** — ce sont des
traces de décision humaine, pas des corrections automatiques de chiffre.
