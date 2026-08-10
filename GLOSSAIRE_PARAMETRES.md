# Glossaire — à quoi sert chaque paramètre/convention/taux

> Écrit pour clarifier une confusion réelle : plusieurs mécanismes très
> différents utilisent des mots proches ("convention", "taux historique")
> et cohabitent dans les mêmes panneaux. Ce document explique chacun
> séparément, avec un exemple concret.

## 1. Conventions de comptes (panneau dédié, 4 clés fixes)

**Ce que c'est** : la catégorisation manuelle des comptes de produit/charge
du dossier, dans l'une de ces 4 catégories :
- `comptes_vente_service` — ex : 706. Les ventes passées sur ces comptes
  suivent la règle "TVA collectée seulement à l'encaissement".
- `comptes_charge_service` — ex : 611, 604. Les achats passés sur ces
  comptes suivent la règle "TVA déductible seulement au paiement".
- `comptes_equipement` — ex : 6063. Sert à détecter les achats de petit
  équipement dépassant un seuil, à vérifier pour un passage en
  immobilisation.
- `comptes_carburant` — ex : 6061. Sert à repérer les achats de carburant
  pour appliquer la règle de déductibilité selon le type de véhicule.

**Ce qui n'est PAS dans ces 4 clés** : tout compte non listé ici est traité
par défaut comme un "bien" — exigible/déductible dès facturation, sans
attendre le paiement. C'est la source du bug du compte 604 rencontré deux
fois : un compte pas ajouté ici retombe silencieusement dans ce défaut.

**Exemple concret** : le compte 706 (vente de services) est dans
`comptes_vente_service`. Une facture de service de janvier, payée en mars,
n'est comptée en TVA collectée qu'en mars — pas en janvier.

## 2. Conventions génériques (panneau "Conventions", candidate/confirmed)

**Ce que c'est** : tout réglage de dossier qui n'entre pas dans les 4 clés
ci-dessus. Aujourd'hui, utilisé uniquement pour :
- `compte_tva_due_autoliquidee` — ex : 4454. Le compte où le dossier
  enregistre la TVA due sur autoliquidation (prestations intracom).
- `compte_tva_deductible_autoliquidee` — ex : 445664. Son pendant
  déductible.

**Différence avec les conventions de comptes** : mêmes mécaniques
techniques (candidate → confirmed), mais un panneau générique à clé libre
plutôt que 4 champs dédiés — pensé pour accueillir d'autres réglages
futurs sans nouvelle migration à chaque fois.

## 3. Taux historique — ⚠️ DEUX usages différents, même nom

C'est la source de confusion la plus probable. Il existe **deux
mécanismes distincts**, tous deux visibles dans le même panneau "Taux
historique" :

### 3a. Taux historique par SOUS-COMPTE de TVA collectée (445711-445714)

**Ce que c'est** : une VÉRIFICATION, pas un choix de taux. Pour chaque
écriture de TVA collectée, le logiciel calcule le taux implicite (TVA ÷
base HT) et le compare à ce qui est historiquement habituel pour ce
sous-compte dans ce dossier. Si ça ne correspond pas, anomalie de
cohérence (signalement d'une possible erreur de saisie).
**Ne couvre PAS** : la déductible, ni l'autoliquidation.
**Exemple** : le compte 445711 (TVA collectée 20%) a toujours porté du
20% dans ce dossier. Une écriture qui donne un taux implicite de 15%
dessus déclenche une vérification.

### 3b. Taux historique par COMPTE CLIENT (411xxx) — chantier B

**Ce que c'est** : un usage totalement différent — sert à choisir le taux
à appliquer sur un encaissement client **sans facture rapprochée du
tout** (donc rien à vérifier, juste une décision à prendre par défaut).
Construit à partir des factures déjà lettrées de ce client : si toutes à
20%, le taux "habituel" de ce client devient 20% (candidate à confirmer).
Si mixte, aucune proposition — le calcul retombe sur 20% par prudence.
**Exemple** : le client SIMON a toujours été facturé à 20% sur ses 5
dernières factures lettrées → proposition "taux habituel SIMON : 20%". Un
encaissement non lettré de ce client applique alors 20%, marqué comme
"taux historique" plutôt que "défaut de prudence".

### Ce qui n'existe PAS (demandé, pas construit)

Un taux **assigné manuellement** (pas juste observé) par compte de
produit/charge, qui servirait à un contrôle de fin d'exercice : vérifier
que la TVA déductible totale correspond exactement au HT du compte de
charge × son taux assigné, une fois les comptes bien répartis par taux.
Idée notée, pas encore scopée ni construite — voir la note du 08/08 en
fin de document.

## 4. Paramètres cabinet

**Ce que c'est** : réglages partagés par TOUS les dossiers d'un même
cabinet — aujourd'hui, uniquement la clé API Mistral. Un cabinet paie un
seul abonnement, pas un par dossier.
**Ne concerne jamais un dossier précis.**

## 5. Paramètres dossier

**Ce que c'est** : réglages propres à UN dossier, clé/valeur libre.
**État actuel : la plomberie existe (table + API), mais RIEN ne lit ces
valeurs aujourd'hui.** Aucun contrôle, aucun calcul n'est influencé par ce
qu'on y met pour l'instant — prévu pour, par exemple, désactiver un
contrôle précis pour ce dossier, ou stocker le pourcentage carburant
choisi, mais pas encore branché.

---

## Note du 08/08 — demande de Rami pas encore traitée

Rami a demandé un mécanisme supplémentaire : pouvoir assigner (pas
seulement observer) un taux à un compte de produit/charge, utilisé en fin
d'exercice pour un contrôle de cohérence globale (TVA déductible totale
vs HT × taux par tranche). Idée notée mais pas confirmée en détail ni
construite — à reprendre dans une session dédiée.
