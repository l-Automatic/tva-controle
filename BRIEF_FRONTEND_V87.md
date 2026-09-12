# Brief frontend v87 — Phase D de la refonte complète (nettoyage final)

## Contexte
Suite du v86 (Phase C terminée et validée, commit `f13cd4d`). Ce
brief lance la **Phase D**, dernière phase du chantier, telle que
décrite dans le plan sauvegardé
(`/root/.claude/plans/stateful-chasing-nova.md`).

Contenu de la phase, tel que déjà validé avec Rami :

### 1. Suppression du code devenu redondant
Les blocs scopés `.popup-large .card`/`button`/sous-onglet et
`.panel-calcul-periode .card`/`button`/`h2` sont désormais des
doublons des règles de base généralisées en Phase C — à supprimer.
Exceptions à garder telles quelles : `.panel-calcul-periode
.montant-principal strong` (choix éditorial délibéré, propre à cet
écran, jamais destiné à se généraliser), et le style `max-width` de
`.popup-large` lui-même (sans rapport avec ce chantier, brief v76).

### 2. Split sémantique de `.secondary`
54 usages dans 17 fichiers, actuellement un seul style rouge-danger
pour deux besoins différents : actions vraiment destructives
("Rejeter", "Retirer", "Désactiver") et actions juste secondaires,
non destructives ("Ignorer", "Annuler"). À séparer en deux classes :
- `.danger` — garde le rouge `--danger-500`, pour les actions
  destructives.
- `.tertiaire` — gris neutre `--neutre-500`, pour les actions
  secondaires non destructives.

Examen au cas par cas des 17 fichiers requis, pas un renommage
aveugle (liste exacte via `grep -rl 'className="secondary"'
packages/frontend/src/components/`).

### 3. Contrôle "dégradé par cabinet" mort depuis la Phase A
Devenu inopérant depuis le repointage de `--degrade-actif` vers
`--accent-500` fixe (Phase A, choix assumé par Rami). À masquer ou
retirer de l'écran Paramètres > Apparence — au choix de Claude Code
selon ce qui est le plus propre à ce stade (masquer l'UI seule, ou
retirer aussi le paramètre backend associé s'il n'a plus aucun autre
usage).

### 4. Documentation
Mettre à jour les commentaires qui décrivent encore l'ancien périmètre
"3 écrans seulement" (v81) pour ne pas induire en erreur — le système
s'applique maintenant à toute l'app.

### 5. Balayage final
Confirmer par `grep` qu'aucune référence aux anciens tokens ne
subsiste nulle part dans `styles.css`.

## Vérification
Comme convenu dans le plan : re-capture ciblée des 17 fichiers
concernés par le split `.secondary`/`.danger`/`.tertiaire`, puis
balayage final (`grep`) pour confirmer zéro référence restante aux
anciens tokens. Confirmer que le contrôle "dégradé par cabinet" a
disparu ou est clairement désactivé dans Paramètres > Apparence.
`npx tsc --noEmit` + `npx vite build`, suite de tests backend
complète.

## Après cette phase
C'est la dernière phase prévue au plan — une fois terminée, faire un
résumé global du chantier (les 4 phases) pour que Rami ait une vue
d'ensemble complète, pas seulement le détail de cette dernière phase.
