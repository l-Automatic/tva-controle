# Brief frontend v21 — bouton "Refuser" sur les suggestions d'autoliquidation

## Contexte
Le panneau "Comptes d'autoliquidation suggérés" (Conventions génériques)
n'a qu'un bouton "Confirmer" par compte, aucun moyen de refuser une
suggestion incorrecte — et comme cette détection est recalculée en direct
à chaque cycle, sans le refuser explicitement le compte revient
indéfiniment.

## Ce qu'il faut faire
Ajouter un bouton "Refuser" à côté de "Confirmer" pour chaque compte
suggéré dans ce panneau. Au clic, appeler
`POST /dossiers/:id/conventions` avec `cle:
'comptes_charge_autoliquidation_rejetee'` et le numéro de compte —
même mécanisme que "Aucune de celles-là" dans le popup principal (clé
technique différente, mais même geste).

Une fois refusé, le compte ne doit plus apparaître dans ce panneau lors
d'un prochain cycle.

## Vérification
Comme toujours : dev server, actions réelles. Refuser un compte suggéré,
relancer un cycle, vérifier qu'il ne réapparaît plus dans "Comptes
d'autoliquidation suggérés".
