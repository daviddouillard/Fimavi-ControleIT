# Droits et autorisations de ControleIT

Inventaire de tous les droits accordés à l'application, à valider par l'IT. État au 2026-11-12.

## 1. Microsoft Entra ID : application « ControleIT »

Une seule inscription d'application, **multi-locataire** :
- ID d'application : `945954d1-abcc-4549-b647-df98f6d040d1` ;
- ID d'objet de l'application d'entreprise : `4ffb980c-7803-43ae-bacf-4c88a001450c`.

| Permission | Type | Usage | Valider |
|---|---|---|---|
| `openid`, `profile`, `email` | Déléguée (connexion) | Connexion des utilisateurs (OIDC avec PKCE et nonce) ; aucun accès aux données de l'utilisateur | ☐ |
| `User.Read.All` | Application | Synchronisation de l'annuaire de chaque tenant (nom, email, service, compte actif) : choix des valideurs | ☐ |
| `Sites.Read.All` | Application | Lecture des sites SharePoint (bibliothèques, éléments, partages) | ☐ |
| `Sites.Selected` | Application | Porte le **contrôle total site par site** (voir §2) | ☐ |

**Non accordé, volontairement :**
- `Mail.Send` dans Entra : il permettrait d'envoyer depuis n'importe quelle boîte. L'envoi est limité par Exchange (voir §3).
- `Sites.FullControl.All` : il donnerait le contrôle total sur tous les sites.
- Aucun droit d'écriture.

Le consentement administrateur est donné dans chaque tenant raccordé, par un administrateur de la filiale.

**Rôle d'application (app role)** : la valeur définie par `NUXT_ADMIN_ROLE` donne le droit administrateur dans ControleIT. Seuls les comptes du tenant principal Fimavi peuvent être administrateurs. Membres du rôle : ☐ à valider.

## 2. SharePoint : contrôle total limité aux sites choisis

Il est accordé par un administrateur SharePoint avec `infra/grant-site-fullcontrol.ps1` (rôle `fullcontrol`, via `Sites.Selected`). Microsoft Graph l'exige pour voir tous les éléments qui ont des permissions propres.

**L'application n'écrit jamais dans SharePoint** : elle ne fait que lire.

Sites concernés (fimavi.sharepoint.com) :

| Site | Valider |
|---|---|
| `tsi` | ☐ |
| `3s_distribution` | ☐ |
| `3s_outlet` | ☐ |
| `3s_services` | ☐ |
| `fimavi` | ☐ |
| `fimavi-si` | ☐ |
| `groupe_a3s` | ☐ |
| `my_metal_factory` | ☐ |

## 3. Exchange Online : envoi des emails (RBAC for Applications)

Configuré le 2026-11-12. `Test-ServicePrincipalAuthorization` : `InScope = True` pour helpdesk.

| Élément | Valeur | Valider |
|---|---|---|
| Principal de service | `ControleIT` (AppId `945954d1-…`) | ☐ |
| Périmètre de gestion | `ControleIT-Helpdesk` : `PrimarySmtpAddress -eq 'helpdesk@fimavi.com'` | ☐ |
| Rôle | `Application Mail.Send`, sur ce seul périmètre | ☐ |

L'application ne peut envoyer **que** depuis `helpdesk@fimavi.com`. Les destinataires possibles sont :
- les valideurs de la session qui ont des lignes en attente ;
- au plus 20 personnes de l'annuaire, ajoutées à la main par un admin.

## 4. Droits dans l'application

| Action | Administrateur IT | Utilisateur (valideur) |
|---|---|---|
| Tableau de bord, sessions, historique, journal d'audit | ✅ | ❌ |
| Créer, ouvrir ou clôturer une session ; relancer une collecte | ✅ | ❌ |
| Assigner des lignes, clôturer une ligne sans validation | ✅ | ❌ |
| Envoyer les emails aux valideurs | ✅ | ❌ |
| Marquer une action de retrait « Fait » | ✅ | ❌ |
| Paramètres (domaines internes, tenants, sites) | ✅ | ❌ |
| Voir et répondre à **ses** lignes assignées (session ouverte) | ✅ | ✅ |
| Voir les lignes d'un autre valideur | ✅ | ❌ |

Toutes les autorisations sont vérifiées côté serveur, à chaque requête. Le compte est revérifié en base à chaque requête : un compte désactivé est refusé. La session dure 1 heure.

## 5. Google Cloud (projet `fimavi-controleit`)

| Compte | Rôle | Portée | Usage | Valider |
|---|---|---|---|---|
| `controleit-run` (exécution du service et du Job de collecte) | `roles/cloudsql.client` | Projet | Connexion à la base | ☐ |
| | `roles/secretmanager.secretAccessor` | Secrets `controleit-app-secret`, `controleit-database-url`, `controleit-entra-client-secret` | Lecture des secrets à l'exécution | ☐ |
| | `roles/run.jobsExecutorWithOverrides` | Job `controleit-collect` uniquement | Lancer une collecte | ☐ |
| `controleit-deployer` (GitHub Actions) | `roles/run.developer` | Projet | Déployer le service et le Job | ☐ |
| | `roles/cloudsql.client` | Projet | Migrations de la base | ☐ |
| | `roles/artifactregistry.writer` | Dépôt d'images `controleit` | Publier l'image | ☐ |
| | `roles/iam.serviceAccountUser` | Compte `controleit-run` uniquement | Déployer avec ce compte | ☐ |
| | `roles/secretmanager.secretAccessor` | Secrets `controleit-db-owner-password`, `controleit-db-app-password` | Migrations et droits de la base | ☐ |
| Dépôt GitHub `daviddouillard/Fimavi-ControleIT`, branche `main` uniquement | `roles/iam.workloadIdentityUser` | Compte `controleit-deployer` | Déploiement sans clé (Workload Identity Federation) | ☐ |

Le service Cloud Run est joignable sur Internet (`--no-invoker-iam-check`) : toute l'authentification passe par Entra ID dans l'application. Aucune clé de compte de service n'existe.

## 6. Base de données (Cloud SQL PostgreSQL)

Détail dans `docs/base-de-donnees.md` et `scripts/db-grants.mjs`.

| Rôle | Droits | Valider |
|---|---|---|
| `controleit_owner` | Propriétaire du schéma ; utilisé uniquement pour les migrations, par le pipeline | ☐ |
| `controleit_app` | Application : lecture, ajout et modification, **sans suppression**, sur les sessions, lignes, utilisateurs, remédiations et collectes | ☐ |
| | **Journal d'audit et historique des emails : ajout seulement** (ni modification ni suppression) | ☐ |
| | Paramètres (tenants, sites, domaines internes) : suppression autorisée | ☐ |

## 7. Secrets (GCP Secret Manager)

| Secret | Contenu |
|---|---|
| `controleit-app-secret` | Clé de scellement des sessions |
| `controleit-database-url` | Connexion du rôle `controleit_app` |
| `controleit-entra-client-secret` | Secret client de l'application Entra (à renouveler avant expiration) |
| `controleit-db-owner-password` / `controleit-db-app-password` | Mots de passe des rôles de base |

Aucun secret n'est dans le code ni dans le dépôt GitHub.
