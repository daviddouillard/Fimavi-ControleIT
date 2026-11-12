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

## 4. Utilisateurs de l'application

### 4.1 Qui peut se connecter

La connexion se fait uniquement avec un compte Microsoft (Entra ID). Il n'y a ni compte local ni mot de passe propre à l'application.

**Règle retenue (2026-11-12)** : « Mes vérifications » est ouvert à **tout le monde sur les domaines internes du groupe** (Paramètres → Domaines internes). L'adresse email ou l'identifiant de connexion du compte doit appartenir à l'un de ces domaines ou à l'un de leurs sous-domaines. Cette règle s'ajoute à celle des tenants.

| Population | Accès | Valider |
|---|---|---|
| Compte actif d'un **domaine interne**, dans le tenant Fimavi ou un tenant filiale raccordé et actif | Connexion possible, profil Utilisateur | ☐ |
| Compte d'un domaine **hors de la liste** (invités, prestataires, gmail…) | Refusé, avec le message « compte n'appartenant pas à un domaine du groupe » | ☐ |
| Membre du groupe administrateur (§4.2) | Toujours accepté, même avec un compte `@…onmicrosoft.com`, pour pouvoir paramétrer les domaines | ☐ |
| Comptes d'un tenant non raccordé, ou d'un tenant désactivé | Refusés | ☐ |
| Compte désactivé dans Entra (constaté à la synchronisation de l'annuaire) | Refusé, y compris en cours de session | ☐ |

**Entra → Applications d'entreprise → ControleIT → Propriétés → « Affectation requise »** :
laisser à **Non**. Le filtrage par domaine est fait par ControleIT, et n'importe quel collaborateur doit pouvoir devenir valideur. Un retrait de domaine prend effet à la connexion suivante, donc au plus tard 1 heure après.

### 4.2 Profils

| Profil | Comment l'obtenir | Valider |
|---|---|---|
| **Administrateur IT** (Tableau de bord, sessions, Historique, Paramètres) | Membre du groupe Entra **`GCP-FIMAVI-ControleIT-Admin`** du tenant principal. Ce groupe est affecté au rôle d'application défini par `NUXT_ADMIN_ROLE` (Entra → Applications d'entreprise → ControleIT → Utilisateurs et groupes) | ☐ Membres du groupe : …… |
| **Utilisateur (valideur)** (Mes vérifications) | Tout autre compte d'un domaine interne (§4.1) | ☐ |

La gestion des administrateurs se fait **uniquement par le groupe** : ajouter ou retirer une personne de `GCP-FIMAVI-ControleIT-Admin`. Aucune personne n'est affectée directement au rôle.

- Il n'y a qu'un seul rôle administrateur, sans rôle en lecture seule.
- Un ajout ou un retrait du rôle prend effet à la connexion suivante, donc au plus tard 1 heure après : c'est la durée d'une session.
- Une désactivation de compte prend effet immédiatement.

### 4.3 Fonctionnalités par profil

| Écran | Fonctionnalité | Administrateur IT | Utilisateur |
|---|---|---|---|
| **Mes vérifications** | Voir les lignes qui **lui** sont assignées (à faire / déjà répondues) | ✅ | ✅ |
| | Répondre : valider le partage, l'arrêter, ou signaler une mauvaise attribution (commentaire obligatoire) | ✅ | ✅ |
| | Changer d'avis tant que la session est ouverte | ✅ | ✅ |
| | Voir les lignes d'un autre valideur | ❌ | ❌ |
| **Tableau de bord** | Sessions en cours, avancement, réponses en attente | ✅ | ❌ |
| | Accès à retirer (pot commun IT), bouton « Fait » | ✅ | ❌ |
| **Session** | Créer une session (choix des sites) et lancer la collecte des partages | ✅ | ❌ |
| | Relancer la collecte (session en brouillon) | ✅ | ❌ |
| | Ouvrir puis clôturer la session | ✅ | ❌ |
| | Consulter toutes les lignes, avec tris et filtres | ✅ | ❌ |
| | Assigner des lignes à un valideur (recherche dans l'annuaire) | ✅ | ❌ |
| | Clôturer une ligne sans validation | ✅ | ❌ |
| | Préparer et envoyer les emails, relancer, ajouter des destinataires de l'annuaire | ✅ | ❌ |
| **Historique** | Toutes les sessions, y compris clôturées, et le journal d'audit | ✅ | ❌ |
| **Paramètres** | Domaines internes du groupe | ✅ | ❌ |
| | Tenants raccordés (ajout, activation, lien de consentement) | ✅ | ❌ |
| | Sites SharePoint (ajout, test, activation) | ✅ | ❌ |
| | Synchronisation de l'annuaire | ✅ | ❌ |

### 4.4 Garanties

- Chaque droit est vérifié **côté serveur, sur chaque requête**, jamais seulement dans l'écran. Un utilisateur qui appelle une adresse d'administration reçoit un refus (403).
- Un valideur ne peut ni lire ni modifier une ligne qui ne lui est pas assignée : l'appartenance est contrôlée sur chaque ligne.
- Toutes les actions sont tracées dans le journal d'audit : connexion, assignation, réponse, envoi d'email, clôture, paramètres. Ce journal ne peut être ni modifié ni effacé par l'application.
- Session de 1 heure ; cookie chiffré, `HttpOnly` et `Secure` ; requêtes d'une autre origine refusées.

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
