# Conventions tests — nettoyage des données créées

## Le problème constaté (10/08)

Après des dizaines de lancements de `npm test` (backend) et de sessions
de vérification en conditions réelles (frontend, Playwright) au cours de
cette session, la base de test contenait 700+ lignes de conventions
réparties sur 81 dossiers jetables, jamais nettoyés — chaque test créant
son propre dossier avec un nom unique (souvent horodaté) sans jamais le
supprimer après coup.

## Convention à suivre à partir de maintenant

**Tout dossier/cabinet créé par un test ou une vérification doit être
nettoyé après usage**, sauf raison explicite de le garder (auquel cas,
documenter pourquoi dans le test lui-même).

### Backend (tests vitest)

- Préfixer le nom du dossier/cabinet créé par `TEST_` (ex: `TEST_frais
  vehicule ${Date.now()}`) — pas obligatoire pour le fonctionnement du
  test, mais rend un nettoyage périodique trivial à filtrer.
- Quand c'est simple à faire sans complexifier le test, nettoyer dans un
  `afterAll`/`afterEach` (DELETE FROM dossiers WHERE id = ..., cascade
  sur le reste).
- Sinon, compter sur le nettoyage périodique ci-dessous — ne pas bloquer
  l'écriture d'un test pour ça.

### Frontend (Claude Code, vérifications en conditions réelles)

Même principe : nettoyer les dossiers/cabinets créés pour une
vérification, sauf si un dossier doit rester pour une raison précise
(dans ce cas, le dire explicitement dans le rapport de vérification).

## Nettoyage périodique (au besoin, pas automatique)

```sql
-- Aperçu avant suppression — à toujours lancer d'abord
SELECT nom, count(*) FROM dossiers
WHERE nom LIKE 'TEST_%' OR nom NOT IN ('Electricien Sandbox Reel')
GROUP BY nom ORDER BY count(*) DESC;

-- Nettoyage réel (cascade sur tout sauf audit_log, à vider avant)
ALTER TABLE calculs_tva_lignes DISABLE TRIGGER ALL;
DELETE FROM audit_log WHERE dossier_id IN (
  SELECT id FROM dossiers WHERE nom NOT IN ('Electricien Sandbox Reel')
);
DELETE FROM dossiers WHERE nom NOT IN ('Electricien Sandbox Reel');
ALTER TABLE calculs_tva_lignes ENABLE TRIGGER ALL;
```

Le trigger de protection sur `calculs_tva_lignes` doit être désactivé
temporairement pour ce nettoyage — bloque à tort une suppression en
cascade (pas seulement une modification directe hors brouillon), bug
réel trouvé le 10/08 en pratique, en cours de correction.
