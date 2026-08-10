# Règles fiscales/comptables demandées & tâches restantes groupées

> Document de référence complémentaire à `STATUT_PROJET.md`. Deux objectifs :
> (1) retrouver, pour chaque règle métier que Rami a demandé d'implémenter,
> ce que dit exactement la règle et ce que fait réellement le logiciel
> aujourd'hui ; (2) regrouper les tâches restantes par proximité pour
> pouvoir les traiter par lots cohérents plutôt qu'une à une au hasard.

---

## PARTIE 1 — Toutes les règles fiscales/comptables demandées, et leur statut réel

### 1. TVA sur encaissement pour les prestations de service (côté vente)

**Règle demandée** : une vente de service ne rend la TVA collectée exigible
qu'au moment de l'encaissement (paiement du client), pas à la facturation —
contrairement à une vente de bien, exigible dès facturation quel que soit
le paiement.

**Implémenté** : oui, entièrement. `exigibilite.ts` regarde, pour chaque
écriture de TVA collectée, si le compte produit associé est dans
`comptes_vente_service` (configuré par dossier). Si oui, la ligne n'est
incluse dans le calcul que si la ligne tiers (411) est lettrée
(`estLettree`). Sinon, exclue avec motif tracé.

**Limite connue** : si le compte produit n'est configuré nulle part
(bien ni service), il est traité par défaut comme un bien — exigible
immédiatement. C'est un choix de prudence côté collecte (on préfère
sur-collecter que sous-collecter), mais ça veut dire qu'un compte de
service mal configuré ne sera jamais détecté automatiquement comme
"manquant" (voir Groupe A plus bas).

### 2. TVA déductible sur achat de service (côté achat)

**Règle demandée** : symétrique du point 1 côté achat — TVA déductible sur
une prestation de service uniquement si la facture est payée.

**Implémenté** : oui, même mécanisme (`exigibilite.ts`, comptes dans
`comptes_charge_service`).

**Historique mouvementé aujourd'hui même** : une version alternative
("correction en bloc par solde fournisseur en fin de période, sans
vérifier facture par facture") a été construite puis **entièrement
retirée** dans la même session, après que Rami s'est renseigné et confirmé
que le droit fiscal exige un calcul précis facture par facture (voir point
4 ci-dessous), pas une approximation globale. Le mécanisme ligne-à-ligne
d'origine a été restauré tel quel.

**Même limite qu'au point 1** : un compte de charge non configuré (ex :
604 pas ajouté à `comptes_charge_service`) retombe silencieusement en
"bien" — vécu concrètement deux fois dans cette session, où le compte 604
(sous-traitance) est passé entre les mailles.

### 3. Biens vs services

**Règle demandée** : un bien est toujours exigible/déductible dès
facturation, peu importe le paiement. Seuls les services suivent la règle
d'encaissement (points 1 et 2).

**Implémenté** : oui. La distinction se fait par la configuration des
comptes produit/charge en "service" (`comptes_vente_service`/
`comptes_charge_service`) — tout le reste est traité comme un bien par
défaut.

### 4. Paiement partiel d'une facture de service — prorata de déduction/collecte

**Règle demandée**, confirmée par Rami après recherche fiscale : un
paiement partiel d'une facture de service ouvre droit à déduction/collecte
**au prorata du montant effectivement payé** (ex : facture 1200€ TTC/200€
de TVA, payée à 600€ → 100€ de TVA déductible, pas 0 ni 200).

**Piège identifié à distinguer** (règle de Rami, pas encore codée) : un
paiement non lettré face à une facture peut être :
- un vrai paiement partiel (rare) → prorata légitime,
- un acompte sur une facture pas encore reçue → aucun droit à déduction,
- une facture simplement pas encore transmise par le client du cabinet →
  statu quo, rien à trancher.

Distinction envisagée par un LLM (Mistral) sur le libellé du mouvement
bancaire/tiers ; un montant "rond" est un indice secondaire jugé trop
fragile seul.

**Implémenté** : **non, très partiellement**. Le comportement actuel est
binaire : `estLettree` = true → tout inclus, false → tout exclu, sans
prorata. Seule brique posée aujourd'hui : `fetchLignesGroupeLettrage`
(connecteur), qui récupère enfin les montants de chaque ligne d'un groupe
de lettrage — avant, seuls les ids étaient connus, jamais les montants.
Reste à construire : détection des candidats, premier vrai appel Mistral,
confirmation humaine, calcul du prorata.

### 5. Autoliquidation TVA (prestations de services intracommunautaires)

**Règle demandée** : sur les comptes 4454 (due) / 445664 (déductible), le
montant porté en comptabilité est le TTC-équivalent facturé par le
fournisseur étranger (pas déjà la TVA) — il faut en extraire la TVA au
taux applicable (20% en pratique quasi systématiquement).

**Implémenté** : oui, avec un **vrai bug corrigé aujourd'hui**. Le code
prenait initialement le montant brut comme s'il s'agissait déjà de la TVA.
Corrigé : `TVA = montant - montant/(1+taux/100)`, soit `montant/6` à 20%
(confirmé avec Rami, pas `/5`). Taux configurable, 20% par défaut.

### 6. Avoirs (notes de crédit)

**Règle demandée** (implicite, principe comptable de base) : un avoir sur
un compte de TVA collectée doit **retrancher** du total, pas s'y
additionner — et inversement pour un avoir reçu d'un fournisseur sur la
déductible.

**Implémenté** : oui, avec un **vrai bug corrigé aujourd'hui**. Le code
utilisait `Math.abs(credit - debit)`, qui détruisait le signe : un avoir
s'additionnait au lieu de se soustraire. Corrigé avec deux nets signés
distincts selon le sens normal du compte (crédit pour collecte, débit
pour déductible).

### 7. Immobilisations

**Règle demandée** : la TVA déductible sur une immobilisation (compte
44562) est toujours exigible dès facturation, jamais soumise à la règle
d'encaissement des services (point 2) — même si le fournisseur qui vend
l'équipement n'est pas payé tout de suite.

**Implémenté** : oui, `exigibilite.ts` ne traite QUE les comptes 44571*
(collecte) et applique la règle service/bien ; 44562 (immobilisations)
n'entre jamais dans ce mécanisme, toujours inclus au calcul.

### 8. Carburant — déductibilité selon type de véhicule

**Règle demandée** : la déductibilité de la TVA sur carburant dépend du
type de véhicule (tourisme vs utilitaire) — un pourcentage différent
(souvent 80% vs 100%) selon le cas, avec un paramétrage par dossier quand
le dossier mixe les deux types.

**Implémenté** : **partiellement**. Le contrôle détecte un achat de
carburant (compte configuré via `comptes_carburant`) et vérifie si le
véhicule concerné est répertorié dans les immobilisations du dossier
(`parcVehicules`). Si absent, anomalie "parc de véhicules non renseigné"
(signalée, pas bloquante), déductibilité indéterminée. **Pas construit** :
un paramètre pour choisir 80%/100% par dossier quand le mix existe.

**Non tranché, arbitrage en attente** : comment classer un véhicule
tourisme/utilitaire — détection automatique par LLM + validation humaine,
ou saisie manuelle directe par le collaborateur. Rami hésite encore,
contrainte notée : immobilisations parfois anciennes, incertitude sur la
capacité de toutes les API à remonter la liste complète.

### 9. Compte d'attente (471) — encaissements non identifiés

**Règle demandée** : tout encaissement sur un compte d'attente doit être
qualifié manuellement avant tout calcul — soit rattaché à une vente (taux
de TVA à préciser), soit reconnu comme sans lien avec une vente
(remboursement d'assurance, régularisation...). Distinction nécessitant un
jugement sur le libellé (LLM, prévu mais pas construit).

**Implémenté** : oui, **entièrement**, bout en bout. Détection
(`detecterEncaissementsNonAffectes`), anomalie **bloquante** tant que non
qualifié, qualification humaine structurée (`vente`+taux ou
`hors_vente`+motif), intégration réelle au calcul une fois qualifié
`vente`, testé en conditions réelles avec une vraie course concurrente.
Seule pièce manquante : le jugement automatique par LLM sur le libellé —
aujourd'hui c'est 100% humain à chaque fois, ce qui est le comportement
voulu en l'absence de LLM construit.

### 10. Encaissements clients non lettrés (chantier B, différent du 471)

**Règle demandée**, confirmée par Rami : par prudence fiscale (le droit de
collecter appartient à l'État), un encaissement sur un **compte client
précis** (pas un compte d'attente générique) et non lettré doit générer de
la TVA collectée automatiquement, sans bloquer :
- taux historique du client s'il est connu et mono-taux → ce taux,
- sinon (compte mixte ou jamais vu) → 20% par défaut (prudence), avec
  possibilité pour le collaborateur d'imposer un autre taux s'il a une
  information contraire.

**Implémenté** : oui, sauf la correction manuelle du taux par défaut.
Détection (`detecterEncaissementsClientAAffecter`), application directe du
taux (historique confirmé ou 20% par défaut), anomalie **non bloquante**
de traçabilité, intégration réelle au calcul, taux historique par compte
client construit de zéro (`taux_historique_tiers`, alimenté
automatiquement à partir des factures déjà lettrées, seuil 3 occurrences).
**Pas fait** : l'endpoint permettant au collaborateur de corriger le taux
appliqué par défaut sur un encaissement précis.

### 11. Nouveau tiers (client/fournisseur) à vérifier

**Règle demandée** : un tiers (compte 401 ou 411) jamais vu auparavant
pour ce dossier doit être signalé pour vérification manuelle — protection
contre la fraude à la TVA par facture de complaisance (faux fournisseur).
Une fois vérifié plusieurs fois sans problème, la confiance progresse.

**Implémenté** : oui, la partie déterministe. Détection
(`verifierNouveauxTiers`), anomalie signalée (non bloquante), progression
de confiance automatique dans `tiers_reference` (nouveau → à surveiller
après 3 cycles → confiance après 6 cycles, seuils arbitraires documentés
comme tels). **Pas fait** : le jugement de risque proprement dit par LLM
sur le nom du tiers (pattern de fraude, fournisseur fictif...) — ici aussi
c'est 100% humain, aucun automatisme au-delà de "jamais vu".

### 12. Compte de TVA non reconnu / hors périmètre

**Règle demandée** (implicite, principe de prudence) : si un compte de la
famille TVA (445*, 4454) a du mouvement mais n'est géré par aucun
mécanisme connu du logiciel (ni collecte, ni déductible standard, ni
autoliquidation configurée), il ne faut jamais l'ignorer silencieusement —
ça pourrait cacher un cas hors périmètre (ex : TVA intracommunautaire).

**Implémenté** : oui. Anomalie **bloquante**, calcul refusé tant que ce
n'est pas vérifié manuellement.

### 13. Cohérence du taux de TVA collectée

**Règle demandée** (implicite) : le taux implicite calculé sur chaque
écriture de TVA collectée doit correspondre au taux habituel du dossier
pour ce compte (ou, à défaut, au taux national attendu) — sinon,
signalement pour vérification (erreur de saisie possible).

**Implémenté** : oui, mais **uniquement côté collecte**, jamais côté
déductible ni autoliquidation. Utilise le taux historique du dossier en
priorité, le taux national en repli.

### 14. Taux nationaux reconnus

**Règle demandée** (référence réglementaire) : 20% (normal), 10% (réduit),
5,5% (réduit), 2,1% (particulier) — les 4 taux officiels français.

**Implémenté** : oui, utilisés partout où un taux doit être validé/normalisé
(calcul, cohérence, historique). Un taux calculé proche d'un taux officiel
(tolérance ±0,5 point) est normalisé vers celui-ci ; un taux qui ne colle à
rien de connu est gardé tel quel pour vérification manuelle plutôt que
d'être corrigé automatiquement.

### 15. Immuabilité du calcul validé

**Règle demandée** (garantie de process, pas une règle fiscale au sens
strict mais une exigence de conformité) : un calcul TVA une fois validé ne
doit plus jamais pouvoir être modifié.

**Implémenté** : oui, garanti par un trigger Postgres (pas juste une
vérification applicative contournable). Un calcul en brouillon peut être
rejeté (erreur de saisie) et redevient brouillon pour être refait — mais
un calcul validé est définitivement figé.

### 16. Prudence fiscale par défaut (principe transversal)

**Règle demandée**, répétée à plusieurs reprises : en cas de doute, la
règle appliquée doit toujours favoriser l'exactitude vis-à-vis de l'État
— jamais sous-collecter, jamais sur-déduire trop tôt.

**Implémenté, mais de façon incohérente selon les mécanismes** — point
important à avoir en tête :
- 471 et compte non reconnu : bloquent, exigent une vérification humaine
  avant tout calcul → cohérent avec la prudence.
- Encaissement client non lettré (chantier B) : applique 20% par défaut
  (le taux le plus élevé) → cohérent.
- **Mais** : un compte de charge/produit non configuré retombe en "bien"
  par défaut, ce qui va dans le BON sens côté collecte (exigible tout de
  suite = prudent) mais dans le MAUVAIS sens côté déductible (déduit tout
  de suite au lieu d'attendre le paiement = pas prudent). C'est exactement
  ce qui a produit le bug du compte 604 deux fois. Tant que la
  catégorisation forcée des comptes (Groupe A ci-dessous) n'est pas faite,
  ce point reste un vrai risque résiduel.

---

## PARTIE 2 — Tâches restantes, regroupées par proximité

### Groupe A — Boucler l'onboarding d'un dossier (le plus prioritaire)

Ces trois points sont en réalité **un seul et même trou** vu sous trois
angles : rien ne force, à l'arrivée sur un nouveau dossier, à passer en
revue tous les comptes/tiers pertinents avant le premier calcul réel.

1. Aucune catégorisation forcée des comptes produit/charge avant le
   premier calcul (cause directe du bug du compte 604, deux fois).
2. `tiers_reference` jamais pré-peuplée — un dossier avec des années
   d'historique inonde le premier cycle d'anomalies "nouveau tiers" non
   pertinentes.
3. `analyserTauxHistorique`/`analyserTauxHistoriqueParTiers` tournent déjà
   à chaque cycle mais rien ne les présente comme une étape d'onboarding
   à part entière — elles alimentent juste un panneau au fil de l'eau.

**Pourquoi les grouper** : les trois se résolvent par le même geste — un
écran ou une étape "onboarding du dossier" qui, en un seul passage,
présente tous les comptes mouvementés à catégoriser, tous les tiers
récurrents à pré-confirmer comme "connus", et tous les taux historiques
détectables d'un coup, plutôt que de laisser ça se découvrir cycle après
cycle. Un seul chantier, pas trois.

### Groupe B — Lisibilité de l'interface (frontend pur, aucune logique métier nouvelle)

1. Pièces affichées par ID Pennylane brut, pas par un libellé/numéro
   lisible.
2. Aucun affichage de la progression de confiance d'un tiers (nouveau →
   à surveiller → confiance) — consultable en base uniquement.
3. `CycleForm`/`AnomaliesPanel` : affichage redondant des mêmes anomalies.

**Pourquoi les grouper** : aucun des trois ne touche au calcul ni au
backend. Un seul passage Claude Code peut traiter les trois d'un coup,
sans risque de casser quoi que ce soit de fiscal.

### Groupe C — Rendre `parametres_dossier` réellement utile

1. Aucun contrôle ne lit `parametres_dossier` — table et API existent
   depuis la migration 008, jamais consommées.
2. Déductibilité carburant 80%/100% — a besoin d'un paramètre par dossier.
3. Correction manuelle du taux appliqué par défaut sur un encaissement
   client (chantier B) — a aussi besoin d'un mécanisme de "réglage
   spécifique à ce dossier/cette écriture".

**Pourquoi les grouper** : les trois ont besoin de la même chose — un
premier vrai exemple de contrôle qui LIT `parametres_dossier` et modifie
son comportement en conséquence. Une fois ce câblage fait une fois (pour
n'importe lequel des trois), les deux autres suivent le même patron.

### Groupe D — Le vrai chantier Mistral (LLM)

Tous ces points attendent la même brique fondatrice : un premier appel
Mistral qui fonctionne réellement (prompt, parsing, gestion d'erreur).

1. Jugement sur le libellé pour le prorata de paiement partiel (point 4).
2. Jugement de risque sur un nouveau fournisseur (point 11).
3. Motif de numérotation des factures (Module 5, jamais commencé).
4. Classification véhicule tourisme/utilitaire, **si** le choix se porte
   sur l'automatique plutôt que la saisie manuelle (arbitrage non tranché).

**Pourquoi les grouper** : une fois l'infrastructure LLM construite pour
l'un de ces quatre cas, les trois autres ne demandent qu'un prompt et une
UI de confirmation différents — pas une nouvelle plomberie.

### Groupe E — Sécurité/infra avant un vrai client payant (pas urgent en solo sandbox)

1. Authentification — header `x-cabinet-id` en clair.
2. Chiffrement de la clé Mistral et du token Pennylane (stockés en clair).
3. Proxy Vite en dev uniquement, pas déployable en production.
4. Cas 409 et cycle de succès du panneau Calculs vérifiés seulement par
   interception réseau, jamais avec un vrai token Pennylane côté frontend.

**Pourquoi les grouper** : aucun rapport avec la logique fiscale, tous
liés au passage "sandbox solo" → "cabinet réel/plusieurs cabinets".
Aucune urgence tant que ce n'est pas le cas.

---

**Note (06/08)** : un "symétrique fournisseur du chantier B" avait été
envisagé (taux historique par compte fournisseur, encaissements
fournisseurs sans facture) puis écarté après clarification avec Rami —
aucune utilité identifiée. Le côté fournisseur a toujours une vraie
facture avec sa propre ligne de TVA à un taux connu (lu directement,
ligne à ligne, cf. point 2 de la partie 1) : deviner un taux n'a de sens
que côté client, où l'encaissement arrive sans aucune facture en face. Et
un paiement fournisseur sans facture du tout n'ouvre simplement aucun
droit à déduction — pas besoin d'appliquer un défaut comme côté client.
