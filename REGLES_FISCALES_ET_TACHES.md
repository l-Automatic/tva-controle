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

---

## Note (09/08) — charte graphique, à reprendre plus tard

Direction retenue par Rami, explicitement mise de côté pour l'instant (pas
un chantier actif) : couleurs unies ou en léger dégradé foncé-vers-clair,
teintes "premium" plutôt que vives — référence citée : le violet-rouge du
site Inqom, le vert de Pennylane. Fond général clair conservé, une seule
couleur d'accent cohérente plutôt que le choix actuel de 15 dégradés.
Recherche qualitative faite sur le site Inqom (pas de valeurs CSS exactes
extraites, le site ne les expose pas en texte brut) : fond très clair,
accent bleu-violet profond utilisé avec parcimonie, beaucoup d'espace
blanc, typographie sans-serif fine. À reprendre pour une vraie refonte
quand Rami sera prêt.

---

## Audit complet du 09/08 — croisement avec la conversation d'origine

Rami a fourni un document exhaustif rédigé dans la conversation d'origine
("conception du système de contrôle/calcul TVA"), organisé par thème
métier. Croisement fait point par point contre ce qui est réellement
construit. Arbitrages tranchés par Rami ce jour-là :

### Traité et construit ce jour

- **Acompte sur un bien = 0% de TVA (art. 269-2-a CGI)** — bug réel :
  chantier B appliquait un taux par défaut à TOUT encaissement client non
  lettré, sans distinguer bien/service. Corrigé : nouveau paramètre dossier
  `regime_tva_encaissement` (`service` / `bien` / `mixte`, défaut
  `service`). En régime `bien`, plus aucune régularisation automatique sur
  encaissement non lettré. Un dossier avec caisse/paiement comptant doit
  être classé `bien` (payé immédiatement, donc collectable tout de suite
  de toute façon, que ce soit un bien ou un service).
- **Parc de véhicules** — la table `immobilisations` était prête depuis le
  schéma initial (candidate/confirmed, source saisie_manuelle) mais AUCUNE
  fonction ne l'alimentait. `ajouterVehiculeManuel`, `retirerVehicule`,
  `listerVehicules` + routes construits. Aucun frontend encore.
- **0% déductible sur l'achat d'un véhicule de tourisme** — nouveau
  contrôle `verifierDeductibiliteVehiculeTourisme`. Limite assumée : pas de
  lien fiable entre une ligne de TVA déductible précise et un véhicule
  précis (surtout pour un véhicule ajouté manuellement, sans référence vers
  une écriture) — signale pour vérification humaine, n'exclut jamais
  automatiquement.
- **Cohérence HT/TVA sur le compte d'autoliquidation spécifique** — nouveau
  contrôle `verifierCoherenceTauxAutoliquidation`, identifie le compte de
  charge lié par co-occurrence sur la même pièce que la ligne 445664
  confirmée (permet de distinguer un 604 autoliquidation d'un 604 classique
  au même taux).
- **Cadeaux clients** — nouvelle 5ᵉ catégorie de convention
  `comptes_cadeaux` (aux côtés de vente/charge service, équipement,
  carburant), 0% déductible dès qu'un compte y est identifié. Pas de seuil
  73€/bénéficiaire appliqué (donnée non disponible à ce niveau) — en
  pratique un seul compte 623 dédié par dossier suffit à trancher.

### Confirmé hors scope, ne pas y revenir sans nouvel arbitrage

Logement dirigeant, mentions obligatoires sur facture (impossible avec
l'architecture actuelle — écritures comptables uniquement, jamais le
contenu réel d'une facture), franchise en base, prorata d'activité mixte,
taux DOM-TOM.

### Toujours en attente

- Restauration — gros morceau, mis de côté volontairement.
- Numérotation de facture / trou de séquence — confirmé nécessiter un LLM
  pour la découverte du motif (une fois par dossier, candidate/confirmed,
  jamais recalculé), dépend du chantier Mistral (Groupe D).
- Sous-traitant BTP qui facture de la TVA à tort (ne devrait jamais en
  facturer) — jamais détecté, pas discuté avec Rami.

### Trouvé en auditant CETTE conversation-ci (pas la conversation d'origine)

**`BRIEF_FRONTEND_V4.md` a été poussé sur le dépôt mais aucune confirmation
n'a jamais été reçue que Claude Code l'a exécuté** — contrairement à tous
les autres briefs (v1/v2/v3/v5), le message suivant de Rami est passé
directement à autre chose. À vérifier/relancer : retrait de
"(sous-traitance)", renommage de la section Taux historique, formulaire
"Ajouter" manquant dans Conventions génériques, suggestions de taux
assigné, libellés lisibles pour les valeurs de taux.

La vérification demandée sur la redondance CycleForm/AnomaliesPanel n'a
jamais été confirmée comme une vérification active de Claude Code — la
réponse de Rami ("plus de redondance") pourrait être une supposition
plutôt qu'un test réel.

---

## Fin de session du 09/08 — dernier point avant pause

**Nouveau, construit en fin de session** : 6ᵉ catégorie de convention
`comptes_immobilisation`, distincte de `comptes_equipement` (qui reste le
seuil "petit équipement à surveiller"). Sert à confirmer les vrais comptes
d'immobilisation (218X, 215X...) pour un contrôle **bloquant** : si une
pièce touche un compte immobilisation confirmé mais que sa TVA déductible
est passée en 44566 au lieu de 44562, c'est une erreur de saisie réelle,
pas une nuance — `verifierCoherenceCompteImmobilisation`. Backend fait et
poussé, **aucun frontend construit ce soir** (Rami arrête la session avant
que ce tour de brief soit lancé).

**`BRIEF_FRONTEND_V6.md` très probablement jamais exécuté non plus** —
même schéma que v4/v5 : aucune confirmation reçue, le fil est passé
directement à v7 (couleurs) et v8 (polish). Concrètement manquant côté
interface, à vérifier à la reprise : catégorie "Cadeaux clients" absente
du popup et de l'onglet Conventions de comptes, écran de gestion du parc
de véhicules jamais construit, paramètre "régime TVA sur encaissement"
jamais exposé dans Paramètres dossier.

**Ajout à la liste des gros morceaux mis de côté** : TVA intracommunautaire
— Rami précise que ça inclut aussi la vérification du statut du
fournisseur concerné (probablement une validation VIES ou équivalent),
pas juste le traitement comptable de l'autoliquidation intracom.

**Prochaine étape annoncée par Rami** : reprendre la liste complète des
contrôles listés tout au début du projet (avant même la conversation
d'origine dont le document exhaustif a été fourni le 09/08) et vérifier,
un par un, si une fonctionnalité du logiciel les couvre. À faire à la
reprise.

---

## Correction du 10/08 — fausse alerte sur les cadeaux clients

Le signalement précédent ("cadeaux clients absent du popup") était une
observation sur un état antérieur, pas un bug réel — la catégorie était
déjà entièrement câblée depuis le commit v6. Confirmé en conditions
réelles après investigation ciblée (backend vérifié sans whitelist
bloquante, frontend vérifié câblé, test de bout en bout après rechargement
de page). Aucune leçon technique à en tirer, sinon : vérifier avant de
recoder, ce qui a été fait cette fois-ci.

**6ᵉ catégorie de convention "Comptes d'immobilisation" : fait, frontend
et backend.** Popup + onglet Conventions de comptes, icône dédiée,
info-bulle expliquant la distinction avec "Comptes d'équipement".

---

## PAUSE explicite du 10/08 — chantier paiement partiel achats à reprendre

Rami demande d'arrêter ici et de revoir l'ensemble de la proratisation/
déductibilité services plus tard, à tête reposée — pas de correctif
supplémentaire ce soir. État exact au moment de la pause :

**Ce qui fonctionne, confirmé** :
- Volet ventes (`calculerProrataEncaissement`) : purement arithmétique,
  jamais touché aujourd'hui, aucune raison de douter.
- Le mécanisme de recherche sans lettrage (facture + paiement candidats
  sur le compte, fenêtre 60 jours) trouve bien les bons candidats et
  appelle réellement le LLM — confirmé par les logs DEBUG_CYCLE.
- La correspondance de nom entre facture et paiement ("ACCORD HOTEL" /
  "CB ACCORD HOTEL") est maintenant bien reconnue par le LLM après le
  dernier ajustement de prompt.

**Ce qui ne va pas, dernier état observé** :
- Après le correctif "ne plus faire confiance à montantFacture du LLM,
  utiliser facture.montantFactureTotal à la place" : le prorata affiché
  est maintenant de **100%** pour l'hôtel ET pour le cabinet comptable
  (qui marchait pourtant correctement avant, à 50%) — régression
  probable introduite par ce dernier correctif, pas encore diagnostiquée.
- **Nouveau et plus inquiétant** : une anomalie de paiement partiel à
  100% est apparue sur le compte **401REXEL**, pour une facture **sans
  aucun paiement du tout** — cette situation ne devrait même pas
  déclencher la logique de recherche d'acompte (`paiementsCandidats`
  devrait être vide, donc `continue` avant tout appel LLM). À
  investiguer en priorité à la reprise : soit le filtre "déjà lettré"
  ne fonctionne pas comme attendu, soit un candidat est trouvé à tort.

**Hypothèse de départ pour la reprise** (non vérifiée) : le dernier
correctif a été fait dans la précipitation en toute fin de session — à
revérifier ligne par ligne avant de creuser plus loin, plutôt que de
supposer une nouvelle cause exotique.

**Périmètre à revoir plus largement, pas juste ce bug ponctuel** : Rami
demande explicitement de revoir "toutes ces anomalies" de proratisation
et déductibilité services à tête reposée — suggère que le chantier
mérite une relecture d'ensemble (architecture, pas juste un bug precis)
plutôt qu'un nouveau correctif isolé.

---

## Chantier API Cabinet Pennylane (10/08) — plan en 4 phases

### Contexte
Jusqu'ici, tout reposait sur un jeton Company API par dossier (vestige du
sandbox mono-société utilisé pendant tout le développement). L'API Cabinet
(Firm API) utilise un seul jeton par cabinet, ciblant un dossier précis via
un segment d'URL (`/companies/{id}/...`), et répond directement à la
question "comment les dossiers arrivent sur la plateforme" : auto-découverte
via `List companies`, pas de CSV, pas de FEC pour un dossier déjà sous
Pennylane.

**Sources confirmées** (documentation officielle, deux points indépendants) :
- Company API : `https://app.pennylane.com/api/external/v2/<ressource>`
- Firm API : `https://app.pennylane.com/api/external/firm/v1/companies/{id}/<ressource>`
- Jeton cabinet généré dans Pennylane : Réglages du cabinet > Jetons cabinet
- Nuance : le jeton cabinet ne voit que les dossiers auxquels la personne
  qui l'a généré a elle-même accès dans Pennylane — pas automatiquement
  tout le portefeuille dans l'absolu.

### Phase 1 — Le socle (EN COURS, backend posé le 10/08)
Construit et poussé :
- `FirmApiClient` (connector-pennylane) — même interface publique que
  `PennylaneClient`, réécrit silencieusement tout chemin `/api/external/v2/...`
  vers son équivalent `/api/external/firm/v1/companies/{id}/...` : toutes
  les fonctions connecteur déjà écrites (lignes par compte, lettrage,
  comptes, balance...) fonctionnent SANS MODIFICATION avec ce nouveau
  client. **À vérifier en conditions réelles avec un vrai jeton cabinet.**
- `fetchDossiersCabinet` — liste les dossiers du cabinet (`List companies`).
  **Forme de réponse (items vs data, noms de champs) à vérifier en
  conditions réelles**, construite à partir de documentation seule.
- `synchroniserDossiersCabinet` — upsert des dossiers découverts. Un
  nouveau dossier est créé `statut='onboarding'`, `regime_tva='reel_normal'`
  (une hypothèse, pas une vérité fiscale) — un dossier déjà connu n'est
  mis à jour que sur nom/siren, jamais sur regime_tva/tva_encaissement/statut.
- Route `POST /synchroniser-dossiers` (admin_cabinet uniquement), jeton lu
  depuis `parametres_cabinet` (clé `pennylane_firm_api_key`, masquée comme
  la clé Mistral).

**Reste à faire pour clore la Phase 1** :
- Vérifier en conditions réelles (vrai jeton cabinet Rami) que
  `fetchDossiersCabinet` et le chemin réécrit par `FirmApiClient`
  fonctionnent bien tels que documentés.
- Frontend : formulaire pour saisir le jeton cabinet (paramètres cabinet),
  bouton "Synchroniser les dossiers", affichage des dossiers
  nouveaux/mis à jour.
- Adapter le déclenchement de cycle : ne plus demander un `pennylaneToken`
  manuel à chaque cycle — utiliser le jeton cabinet stocké + le
  `external_company_id` du dossier.

### Phase 2 — Onboarding d'un dossier nouvellement découvert
Un dossier synchronisé automatiquement a `regime_tva='reel_normal'` par
défaut et `statut='onboarding'` — il faut une étape de configuration
(régime réel, TVA sur encaissement ou non, etc.) avant qu'un premier cycle
soit possible. Pas encore cadré en détail.

### Phase 3 — Import FEC (chantier distinct, pas commencé)
Composant séparé, pas une extension du connecteur Pennylane : lit le
format FEC (texte à plat, colonnes propres au FEC) et le transforme vers
exactement la même structure interne (EcritureTvaComplete[]) que le
moteur de calcul et les contrôles consomment déjà — pour que tout le
reste du projet fonctionne à l'identique, peu importe la source des
données. Point le plus délicat identifié : le lettrage — Pennylane le
représente par un identifiant de groupe numérique, le FEC par un code
partagé entre les lignes rapprochées (`EcritureLet`) — logique de
correspondance différente à écrire entièrement.

### Phase 4 — Autres connecteurs comptables (inqom, ACD, Génération Expert, Cegid Loop)
Mentionné dans la liste d'origine de Rami, jamais creusé. Les valeurs
`logiciel_source` existent déjà dans le schéma (`001_schema_initial.sql`)
pour ces quatre-là, mais aucun connecteur n'existe. Ordre de priorité pas
encore décidé.

---

## nature_operation_mixte — raffinement du prorata service (10/08, RÉSOLU)

Résolu le même jour, une fois le chantier paiement partiel achats corrigé
(popup de rapprochement, validation manuelle par facture). La part
service d'une pièce mixte n'est plus traitée en binaire payé/pas payé —
`identifierFacturesCandidatesAcompte` capte déjà les factures mixtes
comme candidates au rapprochement (elle utilise `.some(...)` sur les
lignes, il suffit qu'une seule touche un compte service), aucune
extension n'a été nécessaire de ce côté.

Formule appliquée dans `exigibilite.ts` quand un rapprochement a été
validé pour la facture (`prorataParEcriture` contient une entrée) :
`prorataExigible = prorataBien + (1 - prorataBien) * prorataPaiementConfirme`
— la part bien reste toujours à 100%, la part service suit le prorata
réellement payé. Hypothèse assumée, jamais vérifiable autrement : le
paiement couvre bien et service proportionnellement à leur part
respective dans le total de la facture. Confirmée explicitement par Rami
avant construction.

Sans rapprochement validé (facture clairement lettrée en 1-pour-1, ou
vente comptant sans ligne tiers) : repli sur l'ancien binaire payé/pas
payé, inchangé.

