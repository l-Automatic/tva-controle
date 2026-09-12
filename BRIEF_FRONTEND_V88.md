# Brief frontend v88 — corrige le contraste au survol, réexamine les anomalies dans la nouvelle direction

## 1. Contraste cassé au survol (sidebar + probablement ailleurs)

Retour de Rami : au survol d'un item de la sidebar, le fond devient
bleu mais le texte reste noir — illisible. Il précise que ce n'est
"pas le seul endroit" où ça arrive.

**À corriger** :
- Le survol de la sidebar en priorité (texte en blanc ou couleur
  claire au survol, pas noir sur fond bleu).
- Auditer plus largement tout état `:hover` de l'app qui change un
  fond en couleur pleine/foncée sans vérifier que le texte reste
  lisible par-dessus — corriger chaque cas trouvé, pas seulement la
  sidebar.

## 2. Les bordures colorées des anomalies n'ont jamais été réexaminées

Rami est explicite : la demande de refonte complète du v83 incluait
**tout**, y compris les choix déjà pris avant (contour coloré + ombre
pulsée sur les anomalies bloquantes/signalées) — pas seulement ce qui
restait à faire. Le plan de la Phase C avait tranché de garder ce
traitement "tel quel, comme un cas à part, jamais généralisé" — ce
choix est à reconsidérer, pas à préserver par défaut.

**Ce qui est demandé** : réexaminer le traitement visuel des
anomalies (gravité bloquant/signalé) dans l'esprit de la nouvelle
direction Stripe/Vercel — épuré, pas criard. Le traitement actuel
(contour complet + ombre pulsée rouge) vient de l'ancienne direction
plus "alerte visuelle appuyée" du tout début du chantier (v79-v80),
pas de la direction Stripe qu'on a retenue depuis. Regarder comment
Stripe/Linear/Vercel signalent typiquement une urgence ou un statut
critique (souvent : une pastille de couleur franche, éventuellement un
fin liseré latéral, rarement un contour complet animé) et proposer un
traitement cohérent avec le reste du nouveau système — sans forcément
tout retirer, mais en questionnant vraiment si le contour complet et
l'ombre pulsée ont leur place dans cette direction épurée, ou si un
signal plus sobre (mais toujours clairement visible pour du bloquant)
serait plus cohérent.

Proposer ton meilleur jugement plutôt que d'exécuter un ancien choix
par défaut — c'est exactement l'esprit du v83.

## Vérification
Comme toujours : dev server, actions réelles, captures avant/après.
Confirmer que le survol de la sidebar (et tout autre endroit trouvé
lors de l'audit) reste lisible. Montrer le nouveau traitement des
anomalies bloquantes/signalées et expliquer le raisonnement derrière
le choix fait.
