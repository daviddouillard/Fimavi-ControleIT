# Audit de sécurité et TNR — Squelette applicatif

- **Date** : 2026-11-02
- **Périmètre** : livraison initiale (auth Entra ID, rôles, synchro annuaire Graph, schéma BDD, journal d'audit, API sessions, pages admin/utilisateur, Dockerfile).
- **Méthode** : revue de code indépendante (OWASP Top 10, vérifiée contre les sources des librairies), `npm audit`, recherche de secrets en dur, TNR complets.

## Constats et traitement

| # | Sévérité | Constat | Statut |
|---|---|---|---|
| 1 | Moyenne | Le gestionnaire Microsoft de nuxt-auth-utils ne gère ni PKCE ni nonce : un code d'autorisation intercepté pouvait être rejoué. | **Corrigé** : flux OIDC maison (`server/utils/entraOidc.ts`) avec state, nonce et PKCE S256. |
| 2 | Moyenne | Droits figés 8 h dans le cookie, compte désactivé toujours accepté. | **Corrigé** : session ramenée à 1 h, compte revérifié en base à chaque requête (`accountEnabled`). Un retrait de rôle Entra prend effet au plus tard en 1 h. |
| 3 | Moyenne | Le rôle applicatif, propriétaire des tables, pouvait désactiver le trigger du journal d'audit. | **Corrigé côté code** : migrations sur un rôle distinct (`DATABASE_MIGRATION_URL`). **À appliquer à l'install** : droits décrits dans `docs/base-de-donnees.md`. |
| 4 | Faible | Sur Cloud Run, l'IP enregistrée dans l'audit est celle du front-end Google. | Ouvert : à traiter au déploiement, une fois l'en-tête `X-Forwarded-For` de Cloud Run vérifié. |
| 5 | Faible | Rate limiting nuxt-security contournable (`X-Forwarded-For` forgeable) et propre à chaque instance. | Ouvert : recommandation Cloud Armor au déploiement. |
| 6 | Faible | `setUserSession` fusionnait avec l'ancienne session. | **Corrigé** : `replaceUserSession`. |
| 7 | Faible | Image Docker non épinglée par digest. | Ouvert : épinglage à faire dans la CI. |
| 8 | Info | id_token non vérifié cryptographiquement (toléré par OIDC Core §3.1.3.7). | **Corrigé** en défense en profondeur : signature RS256 vérifiée avec les clés JWKS du tenant (`jose`). |
| 9 | Info | Les invités B2B du tenant peuvent se connecter. | **Action Entra** : activer « Affectation requise » sur l'application d'entreprise. |
| 10 | Info | CSP sans `default-src` ni `connect-src`. | **Corrigé** : `default-src 'self'` et `connect-src 'self'`. |

Points vérifiés sans constat : autorisation sur chaque route (401/403, pas d'IDOR), CSRF (contrôle de l'Origin plus SameSite=Lax), injection SQL, XSS (aucun `v-html`), SSRF du client Graph, absence de secrets en dur et dans les logs.

## Dépendances (`npm audit --omit=dev`)

- 0 critique, 0 élevée.
- 12 modérées et 2 faibles, toutes dans l'outillage de build de Nuxt (glob, minimatch, archiver, rollup), non embarqué dans `.output`. Le correctif proposé par npm est un retour à Nuxt 4.1.3 : refusé.
- esbuild (lecture de fichiers via le serveur de dev sous Windows) : corrigé par `npm audit fix`.

## TNR

| Suite | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm run test` (unitaires + intégration PGlite : migrations réelles, trigger d'audit, agrégats) | 18/18 |
| `npm run test:e2e` (Playwright sur le build de production) | 11/11 |

Non couvert à ce stade : connexion de bout en bout avec un vrai tenant Entra et appels Graph réels (app registration pas encore créée), déploiement Cloud Run.
