# Brief frontend v12 — numérotation de facture + vérification globale IA

## Contexte
Les 5 chantiers du Module 5 (LLM) sont tous construits côté backend. La
plupart s'affichent déjà via les mécanismes existants (popup catégorisation,
panneau Anomalies). Un seul morceau nécessite une vraie nouveauté
d'interface : le déclenchement manuel de l'analyse du motif de
numérotation.

## 1. Nouveau — Analyse du motif de numérotation (déclenchement manuel)
Dans **Configuration du dossier**, nouvelle section ou bouton : "Analyser
le motif de numérotation des factures".
- Route : `POST /dossiers/:id/motif-numerotation/analyser`, body
  `{pennylaneToken, periodeDebut, periodeFin, utilisateurId}`. Bornage à
  l'exercice en cours par défaut (pas tout l'historique) — proposer les
  dates de l'exercice en cours pré-remplies, modifiables.
- Réponse : `{motifPropose: {prefixe, suffixe, nombreChiffres, description} | null}`.
- Si `motifPropose` est `null` : afficher "Aucun motif cohérent détecté"
  plutôt que rien.
- Si un motif est proposé, il est automatiquement enregistré côté backend
  comme convention `candidate` (clé `motif_numerotation_facture`) —
  affichage attendu dans **Conventions génériques**, où il doit déjà
  apparaître grâce au formulaire générique existant (v4). Vérifier que
  c'est bien le cas plutôt que reconstruire un mécanisme de confirmation
  séparé.
- Amélioration d'affichage souhaitée : dans Conventions génériques,
  quand la clé est `motif_numerotation_facture`, afficher la valeur de
  façon lisible ("Préfixe FA-2025-, 3 chiffres, aucun suffixe") plutôt que
  le JSON brut `{"prefixe":"FA-2025-","suffixe":"","nombreChiffres":3}`.
- Bouton pour relancer l'analyse à tout moment (pas seulement si aucun
  motif n'existe) — l'exercice change, le format peut changer avec lui,
  décision explicite de Rami de ne pas automatiser ce redéclenchement.

## 2. Vérification (pas de nouvelle construction attendue)
Ces éléments utilisent déjà les mécanismes existants — confirmer qu'ils
s'affichent correctement, sans reconstruire quoi que ce soit sauf bug
trouvé :
- Popup de catégorisation : suggestions IA (badge confiance) et
  suggestions "plan comptable" (badge distinct) — déjà construit, v10/v11.
- Panneau Anomalies : nouveaux types `tva_hotel_a_verifier` (signalé),
  `tva_hotel_a_tort` (bloquant), `trou_numerotation_facture` (signalé),
  `paiement_partiel_calcule` (info), `paiement_partiel_a_verifier`
  (signalé) — doivent s'afficher avec leur description sans traitement
  spécial requis.
- Section "Comptes d'autoliquidation suggérés" dans Conventions
  génériques (v10) — déjà confirmé fonctionnel par Rami.

## Vérification finale
Comme toujours : dev server, actions réelles. En particulier : lancer
l'analyse du motif de numérotation avec un vrai token Pennylane et une
vraie clé Mistral, confirmer le motif proposé, puis relancer un cycle et
vérifier qu'un trou de numérotation (s'il y en a un dans les données de
test) apparaît bien dans le panneau Anomalies.
