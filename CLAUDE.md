# ControleIT — Spécification projet

Application web de **contrôles IT** : l'équipe IT (droit Entra spécifique) ouvre des **sessions de contrôle**, assigne des **vérifications** à des collaborateurs, qui y répondent (Oui/Non + commentaire). Les réponses négatives génèrent des **actions de remédiation** pour l'IT. Tout est historisé.

> Les points marqués **[À CONFIRMER]** sont en attente de réponse métier — ne pas les figer dans le code sans validation.

---

## 1. Pré-requis obligatoires (toutes sessions)

1. **Documentation à jour via Context7** : avant d'écrire du code utilisant une librairie (Nuxt, Vue, Nuxt UI, Drizzle, Microsoft Graph, Zod, Vitest, Playwright…), interroger Context7 (`resolve-library-id` puis `get-library-docs`) pour la version utilisée. Si Context7 n'est pas disponible dans la session, lire la doc et les types embarqués dans `node_modules/<paquet>` (README, `.d.ts`) ou la doc officielle. Ne pas se fier à la mémoire pour les API de framework.
2. **Aucun secret en dur** : client secrets, tenant/client IDs, URL de BDD, clés de session, tokens → **uniquement variables d'environnement** (`runtimeConfig` Nuxt, surchargé par `NUXT_*`).
   - `.env` jamais commité (dans `.gitignore`) ; maintenir un **`.env.example`** à jour avec des valeurs factices.
   - En production : secrets injectés depuis **GCP Secret Manager** dans Cloud Run.
   - Les clés `runtimeConfig.public` ne doivent contenir **aucune** donnée sensible.
3. **Audit de sécurité + TNR systématiques après chaque grosse livraison** (nouvelle fonctionnalité, nouveau modèle de contrôle, changement auth/données) :
   - Audit : `/security-review` sur le diff + `npm audit --omit=dev` + revue OWASP Top 10 (authz par route, IDOR, injection, upload, XSS, CSRF, en-têtes).
   - TNR : `npm run typecheck`, `npm run test` (unitaires + intégration) **et** `npm run test:e2e` (Playwright) doivent passer intégralement.
   - Consigner le résultat dans `docs/audits/AAAA-MM-JJ-<sujet>.md` (périmètre, constats, corrections, résultat TNR).
4. Langue : code et identifiants en anglais, UI et documentation en français.

---

## 2. Stack technique

| Couche | Choix | Remarque |
|---|---|---|
| Framework | **Nuxt 4** (Vue 3, TypeScript strict) | SSR + routes serveur Nitro (`server/api`) |
| UI | **Nuxt UI** (Tailwind) | Tableaux, formulaires, modales prêts à l'emploi |
| Auth | **Microsoft Entra ID (OIDC)** : flux maison `server/utils/entraOidc.ts` (state + nonce + PKCE, signature id_token vérifiée via `jose`) ; session via `nuxt-auth-utils` | Ne pas revenir au gestionnaire Microsoft de nuxt-auth-utils (pas de PKCE ni de nonce). Session 1 h, compte revérifié en base à chaque requête |
| Rôles | **App roles Entra** définis sur l'app registration | Lu dans le claim `roles` du token. **Noms de l'app registration et des rôles : imposés par la nomenclature interne, à fournir par l'IT — ne pas inventer, utiliser des variables d'environnement** |
| Annuaire | **Microsoft Graph / Entra ID** (client credentials, `User.Read.All`) | Synchro des collaborateurs en base |
| BDD | **PostgreSQL** (Cloud SQL) + **Drizzle ORM** (migrations versionnées) | Deux rôles : propriétaire (migrations) et applicatif restreint, voir `docs/base-de-donnees.md`. Tests d'intégration avec PGlite |
| Validation | **Zod** sur toutes les entrées serveur | Body, query, params, lignes de fichier importé |
| Import fichiers | `papaparse` (CSV) / `exceljs` (XLSX) | Parsing **côté serveur uniquement** |
| Sécurité HTTP | module `nuxt-security` | CSP, HSTS, rate limiting, limite taille requête |
| Tests | **Vitest** + `@nuxt/test-utils` ; **Playwright** (E2E) | |
| Déploiement | **GCP** : Cloud Run (conteneur) + Cloud SQL + Secret Manager | Projet GCP `Fimavi-ControleIT` (n° 445174732770). **Un seul environnement : la prod** |
| CI/CD | GitHub Actions (`.github/workflows/deploy.yml`) → Artifact Registry → Cloud Run, authentification par Workload Identity Federation (aucune clé de compte de service) | Déploiement automatique sur push vers `main`, après TNR verts. Infra créée une fois par `infra/gcp-setup.ps1`. Région `europe-west9` (Paris), Cloud SQL `controleit-db`, service `controleit` sur l'URL `*.run.app` |
| gcloud local | Lancer via **PowerShell** (le shim bash ne trouve pas Python). Toujours passer `--project fimavi-controleit` : la config par défaut pointe sur un autre projet, ne pas la modifier | |
| Source | GitHub `daviddouillard/Fimavi-ControleIT`, branche `main` | Claude est autorisé à pousser sur GitHub et à déployer sur GCP, après l'audit de sécurité et des TNR verts |

### Points de vigilance (versions actuelles)
- **Nuxt ≥ 4.6** : les helpers serveur s'importent depuis `nuxt/server` (`defineEventHandler`, `readValidatedBody`, `getValidatedQuery`, `createError({ status })`…). Pour un upload, utiliser `event.req.formData()`.
- **nuxt-auth-utils 0.6** : la session est scellée avec `NUXT_APP_SECRET` (l'ancien `NUXT_SESSION_PASSWORD` est obsolète).
- **Zod 4** (`z.uuid()`, `z.iso.datetime()`), **Nuxt UI 4** (`UTable` avec colonnes TanStack, `UModal v-model:open`).

### Commandes
| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de dev (nécessite un `.env`) |
| `npm run typecheck` | Vérification TypeScript (serveur + pages) |
| `npm run test` | Tests unitaires Vitest |
| `npm run test:e2e` | Build + E2E Playwright (valeurs factices générées, sans BDD) |
| `npm run db:generate` / `db:migrate` | Migrations Drizzle |
| `npm run audit:deps` | Audit des dépendances de production |

---

## 3. Modèle fonctionnel

### Rôles
- **Administrateur IT** : crée/clôture les sessions, importe les fichiers, assigne les vérifications, traite les actions de remédiation, consulte tout l'historique.
- **Utilisateur** : voit uniquement **ses** vérifications, répond Oui/Non + commentaire.

### Concepts
- **Modèle de contrôle** (`control_template`) : type de contrôle extensible. Premier modèle : **Droits SharePoint externes**. Chaque modèle définit son parseur d'import, ses colonnes affichées et ses règles de remédiation → architecture **plugin par modèle** (`server/controls/<template>/`).
- **Session de contrôle** : instance d'un modèle (nom, période, statut `brouillon → ouverte → clôturée`).
- **Élément à vérifier** (`check_item`) : une ligne extraite du fichier importé (données brutes en JSONB + champs normalisés).
  - Modèle SharePoint externe, V1 : **import d'un fichier CSV** des accès externes. V2 envisagée : collecte directe via Microsoft Graph (voir §6).
  - **Les doublons sont supprimés à l'import** : une même combinaison ressource + bénéficiaire + droit ne crée qu'une ligne. La clé exacte sera définie avec le CSV réel. Le nombre de doublons écartés est affiché et tracé dans l'audit.
- **Assignation** : élément → collaborateur (issu de l'annuaire Entra), **choisie manuellement par l'admin**, avec **sélection multiple** pour assigner plusieurs lignes d'un coup. Le valideur est généralement le **N+1** du collaborateur concerné, pas le collaborateur lui-même. L'application peut **suggérer** un valideur, mais l'admin décide toujours.
- **Clôture d'une ligne sans validation** : l'admin peut clôturer une ligne sans l'assigner, quand l'accès est déjà connu comme légitime et qu'aucune validation n'est nécessaire. C'est tracé dans l'audit.
- **Réponse** : Oui (accès légitime) / Non (à retirer). **Commentaire obligatoire si Non**, facultatif si Oui.
  - Le valideur ne peut **que** répondre Oui/Non et commenter : il ne réaffecte rien et ne signale rien.
  - Il peut **changer d'avis** tant que la session est ouverte. Chaque changement est tracé ; si une réponse passe de Non à Oui, l'action de retrait encore « à faire » est annulée.
  - Il ne voit **que les lignes que l'admin lui a assignées**.
- **Action de remédiation** : créée automatiquement sur réponse « Non ». Elle va dans un **pot commun de l'IT** (pas d'attribution nominative), statut `à faire → fait`. **V1 : retrait de l'accès fait manuellement par l'IT**, puis marqué « fait » dans l'application. Une action faite **disparaît de la liste à faire** et reste consultable dans l'historique, avec qui l'a traitée et quand.
- **Pas d'échéance**, **pas d'export** et **pas de lien entre sessions** : chaque session repose la question, même pour un accès déjà validé auparavant.
- **Un seul rôle admin** (pas de rôle lecture seule).
- **Journal d'audit** : table **append-only** de toutes les actions (qui, quoi, quand, avant/après). Jamais de UPDATE/DELETE dessus.
- **Rétention** : tout est conservé en base indéfiniment (sessions, réponses, audit). Pas de purge automatique.
- **Notifications** : aucune en V1 (ni mail ni Teams). Prévu dans un second temps.

### Écrans
- **Accueil admin** : sessions en cours, avancement (% répondu), réponses en attente, liste des accès à retirer (pot commun IT, bouton « Fait »).
- **Détail session** : éléments, assignations, réponses, filtres, export.
- **Historique** : navigation dans toutes les sessions (y compris clôturées) et dans le journal d'audit.
- **Espace utilisateur** : liste de mes vérifications à faire / faites.

---

## 4. Règles de sécurité applicatives

- **Autorisation vérifiée côté serveur sur chaque route** (middleware + contrôle d'appartenance de la ressource) — jamais seulement côté client.
- Un utilisateur ne peut lire/modifier que ses propres assignations (anti-IDOR).
- Upload : liste blanche d'extensions/MIME, taille max via env, parsing en mémoire, aucun fichier exécuté ni servi tel quel ; neutraliser l'injection de formules à l'export CSV/XLSX.
- Requêtes BDD uniquement via l'ORM / requêtes paramétrées.
- Pas de `v-html` sur des données importées ou saisies.
- Logs applicatifs sans secrets ni tokens.

---

## 5. Conventions

- Structure Nuxt 4 : `app/` (front), `server/` (API, utils, controls), `shared/` (types et schémas Zod partagés).
- Variables d'environnement préfixées `NUXT_` et déclarées dans `nuxt.config.ts > runtimeConfig`.
- Toute nouvelle variable d'environnement doit être ajoutée à `.env.example` dans le même changement.
- Migrations Drizzle commitées ; jamais de modification manuelle du schéma en base.

---

## 6. Feuille de route

- **V1** : auth Entra et rôles, synchro de l'annuaire, sessions, import CSV SharePoint externe, assignation manuelle, réponses utilisateur, remédiation manuelle, journal d'audit, accueil admin, historique.
- **V2 (pistes)** :
  - Collecte directe des partages externes via Graph (droits applicatifs `Sites.Read.All` en lecture seule) au lieu du CSV.
  - Identifier l'auteur du partage dans le journal d'audit Microsoft 365, puis suggérer son N+1 (`/users/{id}/manager`) comme valideur.
  - Notifications mail ou Teams et relances.
  - Retrait automatique de l'accès via Graph, avec validation de l'IT.
  - Autres modèles de contrôle, définis au fur et à mesure : garder l'architecture plugin par modèle générique.
