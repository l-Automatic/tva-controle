# Brief frontend v9 (corrigé) — cadeaux manquants + nouvelle catégorie

## Contexte
Correction du diagnostic initial : `BRIEF_FRONTEND_V6.md` **a bien été
appliqué** (parc de véhicules et régime TVA sur encaissement existent déjà
dans l'interface) — pas besoin de les reconstruire, juste les vérifier
rapidement au passage. En revanche, la catégorie "Cadeaux clients" reste
absente du popup de catégorisation et de l'onglet Conventions de comptes,
malgré le fait qu'elle faisait partie de v6 — à investiguer et corriger.

## 1. Vérification rapide (pas de reconstruction attendue)
Confirmer que ces deux éléments de v6 sont bien fonctionnels :
- Écran de gestion du parc de véhicules dans Configuration du dossier
  (ajout/liste/retrait).
- Select "régime TVA sur encaissement" dans Paramètres dossier.

## 2. Corriger : Cadeaux clients manquant
Le popup de catégorisation et l'onglet Conventions de comptes doivent
proposer "Cadeaux clients" comme option — `cle: 'comptes_cadeaux'`, même
route existante (`POST /dossiers/:id/conventions`). Vérifier pourquoi ça
n'est pas passé la première fois (bug d'implémentation, oubli, ou
condition qui masque cette catégorie) plutôt que de simplement re-coder à
l'identique.

## 3. Nouveau (10/08) — Comptes d'immobilisations
S'ajoute aux catégories existantes, dans le popup ET l'onglet Conventions
de comptes : **Compte d'immobilisation**, `cle: 'comptes_immobilisation'`.
Sert à un contrôle bloquant : si une pièce touche un compte confirmé dans
cette catégorie mais que sa TVA déductible est en 44566 au lieu de 44562,
c'est signalé comme erreur de saisie à corriger.

## Vérification
Avant de clore : toutes les catégories de comptes (service vente, service
charge, équipement, carburant, cadeaux, immobilisation — 6 au total)
doivent apparaître ensemble dans le même popup et le même onglet.
