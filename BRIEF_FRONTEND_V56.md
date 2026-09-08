# Brief frontend v56 — TVA sur les débits (fournisseur) + réorganisation de l'onglet tiers

## 1. Case à cocher — TVA sur les débits, à côté des comptes fournisseurs

Dans l'onglet "confiance des tiers", pour chaque compte **fournisseur**
(401xxx) affiché : une case à cocher "A opté pour la TVA sur les
débits". Cochée = ce fournisseur facture sa propre TVA dès facturation
plutôt qu'à l'encaissement — pour nous, ça veut dire qu'on peut déduire
sa TVA dès facturation même si le service n'est pas encore payé.

Cette case n'a de sens que côté **fournisseurs** — ne pas l'afficher
sur les comptes clients.

**Lecture** : le champ `opteTvaDebits` est déjà présent dans la réponse
de `GET /dossiers/:dossierId/tiers` (aux côtés de `niveauConfiance`
etc.) — rien à récupérer séparément.

**Écriture** : `POST /dossiers/:dossierId/tiers/opte-tva-debits` avec
`{numeroCompteTiers, opteTvaDebits: true|false}`. 404 si le tiers est
introuvable pour ce dossier (ne devrait pas arriver en usage normal,
gérer proprement quand même).

## 2. Réorganiser l'onglet "confiance des tiers" en deux sous-onglets

Même principe exactement que la scission déjà faite pour l'onglet
Paramètres (cabinet/dossier) — deux sous-onglets : **"Clients"** et
**"Fournisseurs"**. La case TVA sur les débits n'apparaît que dans le
sous-onglet Fournisseurs, comme précisé au point 1.

Distinguer client/fournisseur par le préfixe du numéro de compte (411
pour client, 401 pour fournisseur) — même logique que le reste de
l'app pour cette distinction.

## Vérification
Comme toujours : dev server, actions réelles. Cocher la case sur un
vrai fournisseur, relancer un cycle réel avec une facture de service
non payée de ce fournisseur, confirmer que la TVA est bien déduite
malgré l'absence de paiement. Décocher, relancer, confirmer que le
comportement redevient normal (pas déduit tant que non payé).
Confirmer que les deux sous-onglets sont bien navigables et que la
case n'apparaît que côté fournisseurs.
