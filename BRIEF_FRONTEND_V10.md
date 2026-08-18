# Brief frontend v10 — affichage des suggestions IA

## Contexte
Le backend calcule maintenant des suggestions IA (Mistral) dans deux
endroits, mais rien ne les affiche encore côté interface. Premier vrai
usage du LLM dans ce projet — traiter avec la même prudence que le reste :
**une suggestion n'est jamais pré-cochée au point de pouvoir être validée
sans un geste conscient de l'utilisateur.**

## 1. Popup de catégorisation — afficher la suggestion
Le résultat d'un cycle (`comptesACategoriser`) contient maintenant, pour
chaque compte, un champ optionnel :
```
suggestionIA?: {
  compte: string;
  categorieSuggeree: string | null; // une des 6 clés de catégorie, ou null
  confiance: 'haute' | 'moyenne' | 'basse';
  justification: string;
}
```
Quand ce champ est présent :
- Présélectionner visuellement l'option correspondant à `categorieSuggeree`
  dans le select (si ce n'est pas `null`) — mais l'utilisateur doit tout de
  même cliquer sur "Ajouter" pour que ça compte, jamais de validation
  automatique.
- Afficher la justification en petit texte à côté (icône ampoule ou
  équivalent), avec le niveau de confiance visible (badge discret :
  haute/moyenne/basse).
- Si `categorieSuggeree` est `null` : ne rien présélectionner, mais
  afficher quand même la justification ("le LLM n'est pas confiant, à
  vérifier vous-même").
- Si `suggestionIA` est absent (pas de clé Mistral configurée, ou l'appel a
  échoué) : comportement actuel inchangé, aucune suggestion affichée.

## 2. Suggestions pour le compte autoliquidation
Nouveau champ dans le résultat d'un cycle :
```
comptesAutoliquidationSuggeres: Array<{
  compte: string;
  exemplesLibelle: string[];
  suggestionIA?: {
    categorieSuggeree: string | null; // 'comptes_charge_autoliquidation' ou null
    confiance: 'haute' | 'moyenne' | 'basse';
    justification: string;
  };
}>
```
Nouvelle petite section, dans **Configuration du dossier → Conventions
génériques** (là où vit déjà `comptes_charge_autoliquidation`) : liste des
comptes suggérés avec leur justification, et un bouton "Confirmer" par
ligne qui ajoute le compte à la convention `comptes_charge_autoliquidation`
en un clic (route déjà existante : `POST /dossiers/:id/conventions` puis
confirmation). N'afficher cette section que si la liste n'est pas vide.

## Vérification
Comme toujours : dev server, actions réelles. Rami a une vraie clé Mistral
configurée dans Paramètres cabinet — vérifier avec un vrai cycle, pas
seulement en mockant la réponse.
