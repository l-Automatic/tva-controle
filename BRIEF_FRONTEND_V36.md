# Brief frontend v36 — retire `nature_operation_mixte` des anomalies

## Contexte
`nature_operation_mixte` n'est plus générée du tout côté backend — même
raisonnement et même mécanisme que `paiement_partiel_calcule` (v35) : le
prorata bien/service d'une pièce mixte est déterministe (un paiement
s'apprécie contre la facture entière, jamais contre une de ses lignes
précises — rien à faire vérifier par un humain). Porté désormais via le
même champ `prorataAppliques` déjà branché depuis le v35, sans distinction
particulière entre les deux origines (paiement partiel pur ou nature
mixte) — c'est la même information de même nature.

## Ce qu'il faut faire
Retirer `nature_operation_mixte` de tout endroit où les types d'anomalies
sont codés en dur côté frontend (menu de filtrage, libellés, icônes —
mêmes fichiers que ceux corrigés au v33 : `AnomaliesPanel.tsx`,
`icons.ts`, et tout autre endroit trouvé en cherchant).

Rien d'autre à construire : `prorataAppliques` affiche déjà cette
information dans le panneau de calcul depuis le v35, ce mécanisme n'a pas
changé.

## Vérification
Comme toujours : dev server. Ouvrir le menu déroulant de filtrage des
anomalies dans Historique, confirmer que `nature_operation_mixte` n'y
apparaît plus. Provoquer une vraie pièce mixte, vérifier qu'elle
n'apparaît jamais dans le panneau Anomalies mais que son prorata est bien
visible dans le panneau de calcul.
