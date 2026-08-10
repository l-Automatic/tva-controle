# Catalogue des anomalies — tout ce que le logiciel peut signaler

> Chaque anomalie a un `type` (identifiant technique, visible dans les
> détails bruts), une `gravite` (`bloquant` = arrête le calcul tant que ce
> n'est pas traité manuellement ; `signale` = n'empêche rien, juste une
> alerte à vérifier), et un déclencheur précis. 12 types existent
> aujourd'hui, listés dans l'ordre où ils apparaissent dans un cycle.

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

### `ligne_tiers_introuvable`
**Déclencheur** : une vente identifiée comme "service" (donc soumise à la
règle d'encaissement) n'a aucune ligne client (411) rattachée à la pièce
— impossible de vérifier si c'est payé.
**Action attendue** : vérifier la pièce ; le calcul suppose exigible par
défaut en attendant.

### `paiement_partiel_a_verifier`
**Déclencheur** : sur une vente de service, la ligne client est lettrée,
mais son groupe de lettrage contient plus de 2 lignes — signe possible
qu'un paiement couvre plusieurs factures, qu'une facture est payée en
plusieurs fois, ou qu'un acompte est mélangé avec autre chose.
**Ce que ça ne veut PAS dire** : le calcul actuel inclut ou exclut la
totalité du montant selon que la ligne est lettrée ou non — **pas de
prorata aujourd'hui**, juste un signalement pour vérification manuelle.
Le calcul du prorata réel est un chantier en cours, pas encore terminé
(voir `REGLES_FISCALES_ET_TACHES.md`, point 4).
**Action attendue** : vérifier manuellement le détail du groupe dans
Pennylane.

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

### `flotte_mixte_carburant`
**Déclencheur** : le dossier a À LA FOIS des véhicules tourisme et
utilitaires répertoriés — le logiciel ne peut pas savoir automatiquement
à quel véhicule un achat de carburant précis se rapporte.
**Action attendue** : décision humaine sur le taux applicable pour cette
écriture précise (pas de mécanisme de correction dédié construit à ce
jour — traité comme les autres anomalies signalées, résoudre/justifier).

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
