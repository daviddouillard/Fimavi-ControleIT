# Droits et autorisations de ControleIT

Inventaire de tous les droits accordés à l'application, à valider par l'IT. État au 2026-11-12.

## 1. Microsoft Entra ID : application « ControleIT »

Une seule inscription d'application, **multi-locataire** :
- ID d'application : `945954d1-abcc-4549-b647-df98f6d040d1` ;
- ID d'objet de l'application d'entreprise : `4ffb980c-7803-43ae-bacf-4c88a001450c`.

| Permission | Type | Usage | Valider |
|---|---|---|---|
| `openid`, `profile`, `email` | Déléguée (connexion) | Connexion des utilisateurs (OIDC avec PKCE et nonce) ; aucun accès aux données de l'utilisateur | ☐ |
| `User.Read.All` | Application | Synchronisation de l'annuaire de chaque tenant (nom, prénom, email, service, compte actif) : choix des valideurs | ☐ |
| `GroupMember.Read.All` | Application | Modèle « Accès Sage » : membres des groupes Entra COMPTA_USER, MDP_USER et GESTCOM_USER du tenant principal (sous-groupes compris), en lecture seule | ☐ |
| `Sites.Read.All` | Application | Lecture des sites SharePoint (bibliothèques, éléments, partages) | ☐ |
| `Sites.Selected` | Application | Porte le **contrôle total site par site** (voir §2) | ☐ |
| `AuditLogsQuery-SharePoint.Read.All` | Application | Lecture du journal d'audit **SharePoint uniquement** : retrouver qui a créé chaque partage (180 jours) | ☐ |
| `Exchange.ManageAsApp` (API « Office 365 Exchange Online ») | Application | Lecture des boîtes partagées et de leurs droits (modèle « Accès aux boîtes partagées ») ; sans effet seule, les droits réels viennent du rôle « Lecteur général » (§3.2) | ☐ |

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

### 3.2 Lecture des boîtes partagées (modèle « Accès aux boîtes partagées »)

Lecture seule, dans chaque tenant analysé :

| Élément | Valeur | Valider |
|---|---|---|
| Permission | `Exchange.ManageAsApp` (application), consentie dans le tenant | ☐ |
| Rôle Entra attribué à l'application | **Lecteur général** (Global Reader) : lecture seule, aucune modification possible | ☐ |
| Commandes utilisées | `Get-Mailbox` (boîtes partagées, « envoyer de la part de »), `Get-MailboxPermission` (accès total), `Get-RecipientPermission` (envoyer en tant que) | ☐ |

- L'application n'envoie **que** ces trois commandes de lecture : toute autre commande est refusée dans le code (`server/utils/exchange.ts`).
- Service utilisé : `https://outlook.office365.com/adminapi/beta/<tenant>/InvokeCommand`, celui du module PowerShell officiel ExchangeOnlineManagement. Il n'est pas documenté publiquement par Microsoft et peut évoluer : en cas de panne, le bouton « Tester Exchange » des paramètres le signale.
**État au 2026-11-18** :

| Tenant | `Exchange.ManageAsApp` consentie | « Lecteur général » attribué (actif, permanent) | « Tester Exchange » |
|---|---|---|---|
| Fimavi (`9f74a43a-…`) | Oui (vérifié) | Oui (vérifié le 2026-11-18) | À refaire après propagation (jusqu'à 1 h) |
| Beaufils Solaire (`7b4fd49d-…`) | Consentement à confirmer | Attribué par l'IT, non vérifié par l'application | À refaire après propagation (jusqu'à 1 h) |

- Le rôle doit être attribué en **Actif** et **permanent** : une attribution « Éligible » (PIM) ne fonctionne pas pour une application. Sans le rôle, Exchange répond 403, même avec la permission consentie.
- « Lecteur général » donne une lecture de toute la configuration Microsoft 365 du tenant, sans le contenu des emails ni des fichiers. Une piste plus restreinte est un groupe de rôles Exchange limité à « View-Only Recipients », attribué au principal de service. Elle sera à valider une fois le module en service.

### 3.3 Gandi : lecture des domaines, certificats et hébergements (modèle « Services Gandi »)

| Élément | Valeur | Valider |
|---|---|---|
| Jeton | Jeton d'accès personnel (PAT) Gandi, limité à **une organisation** | ☐ |
| Droits du jeton | « Voir et renouveler les domaines », « Voir et télécharger les certificats SSL », « Voir et renouveler les instances Web Hosting » : Gandi ne propose pas de droit en lecture seule pour ces services. Aucun droit technique, DNS, facturation ni gestion. « Voir les ressources Cloud » n'est pas utilisé : à retirer du jeton | ☐ |
| Durée | La plus courte acceptable (1 an au plus) ; date de fin notée pour le renouveler | ☐ |
| Stockage | Secret Manager `controleit-gandi-token`, lu par le compte `controleit-run` ; variable GitHub `GANDI_TOKEN_SECRET` = nom du secret | ☐ |

- L'application ne fait que des lectures (`GET` sur `domain/domains`, `certificate/issued-certs`, `simplehosting/instances`) ; elle n'appelle jamais de renouvellement. Le jeton n'est envoyé qu'à `https://api.gandi.net/v5/` (`server/utils/gandi.ts`).
- Les serveurs GandiCloud (VPS) ne sont pas lus : ils passent par l'API OpenStack, avec d'autres identifiants que le jeton Gandi.
- Certificats expirés, révoqués ou remplacés et hébergements en cours de suppression : ignorés (rien à renouveler).
- Le jeton n'est jamais renvoyé au navigateur : les paramètres indiquent seulement s'il est configuré.
- « Ne plus renouveler » crée une action pour l'IT, qui désactive le renouvellement automatique **à la main** dans Gandi.
- **État au 2026-11-18** : jeton « ControleIT » créé dans l'organisation FIMAVI (expire dans un an : à renouveler avant novembre 2027), rangé dans `controleit-gandi-token` (accès `controleit-run` vérifié), variable GitHub posée, service redéployé.
- Création du secret sous Windows : utiliser une fenêtre PowerShell **non administrateur** (gcloud est installé dans le profil de l'utilisateur) et passer le jeton par un fichier sans retour à la ligne, supprimé ensuite.

### 3.4 Sage : comptes par dossier (modèle « Accès Sage »)

| Élément | Valeur | Valider |
|---|---|---|
| Source | API interne **A3SreportingSage** sur fimapi2 (projet Visual Studio `source/repos/A3SreportingSage`), route `GET /DroitAcces/Get_DroitAccesGroupe` : table `GROUPE.dbo.LOGINS_SAGE` (`ID_LOGIN_SAGE`, `PR_Nom`, `id_ad`, `site`, `IntituleDossier`). **Les mots de passe Sage (`PR_Pwd`, `PR_PWDCrypte`) ne sont jamais lus par l'API** | ☐ |
| Compte SQL de l'API | `SQL_ControlIT`, droit `SELECT` sur `dbo.LOGINS_SAGE` uniquement ; chaîne de connexion en variable d'environnement IIS (`ConnectionStrings__Groupe`), jamais dans le code | ☐ |
| Clé | Clé `X-API-KEY` dédiée (table `ApiKeys`, `Utilisateur = 'A3SreportingSage'`) : Secret Manager `controleit-sage-api-key`, lu par `controleit-run` ; variable GitHub `SAGE_API_KEY_SECRET` = nom du secret, `SAGE_API_URL` = adresse de base de l'API | ☐ |
| Réseau | fimapi2 filtre les IP : le service et le Job sortent par le VPC `default` et le Cloud NAT `controleit-nat` (IP statique `controleit-nat-ip`, `infra/gcp-nat.ps1`), IP autorisée côté Fimavi ; variable GitHub `VPC_EGRESS_NETWORK=default` | ☐ |
| Groupes Entra | `NUXT_SAGE_GROUPS` (par défaut `COMPTA_USER,MDP_USER,GESTCOM_USER`), groupes synchronisés depuis l'AD local, lus avec `GroupMember.Read.All` | ☐ |

- Une ligne par compte Sage et par dossier, dossiers de test et d'archive compris. La personne est retrouvée dans Entra par son identifiant Windows (`id_ad` = `onPremisesSamAccountName`, à défaut le début de l'UPN) ; son N+1 est suggéré comme valideur.
- Écart signalé (lignes en tête) : compte Sage d'une personne qui n'est dans aucun des groupes Entra Sage. Si un groupe est illisible, aucun écart n'est signalé (il serait faux) et l'erreur apparaît dans le compte rendu de collecte.
- La clé n'est envoyée qu'à l'adresse configurée (HTTPS obligatoire, redirections refusées) ; seul le statut HTTP est conservé en cas d'erreur.
- « Retirer l'accès » crée une action pour l'IT, qui retire le compte du dossier **à la main** dans Sage.

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
| | Répondre : conserver (valider le partage, conserver l'accès, renouveler), arrêter (arrêter le partage, retirer l'accès, ne plus renouveler), ou signaler une mauvaise attribution (commentaire obligatoire) | ✅ | ✅ |
| | Changer d'avis tant que la session est ouverte | ✅ | ✅ |
| | Voir les lignes d'un autre valideur | ❌ | ❌ |
| **Tableau de bord** | Sessions en cours, avancement, réponses en attente | ✅ | ❌ |
| | Accès à retirer (pot commun IT), bouton « Fait » | ✅ | ❌ |
| **Session** | Créer une session (partages SharePoint : choix des sites ; boîtes partagées : choix des tenants ; services Gandi ; accès Sage) et lancer la collecte | ✅ | ❌ |
| | Relancer la collecte (session en brouillon) | ✅ | ❌ |
| | Ouvrir puis clôturer la session | ✅ | ❌ |
| | Consulter toutes les lignes, avec tris et filtres | ✅ | ❌ |
| | Assigner des lignes à un valideur (recherche dans l'annuaire, directement dans le tableau ou d'un clic sur l'auteur / le N+1) | ✅ | ❌ |
| | Clôturer une ligne sans validation | ✅ | ❌ |
| | Préparer et envoyer les emails (corps unique mis en forme, signature comprise), relancer, ajouter des destinataires de l'annuaire | ✅ | ❌ |
| **Historique** | Toutes les sessions, y compris clôturées, et le journal d'audit | ✅ | ❌ |
| **Paramètres** | Domaines internes du groupe | ✅ | ❌ |
| | Tenants raccordés (ajout, activation, lien de consentement) | ✅ | ❌ |
| | Sites SharePoint (ajout, test, activation) | ✅ | ❌ |
| | Renommer un tenant, tester Exchange, tester Gandi, tester Sage | ✅ | ❌ |
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
| | `roles/secretmanager.secretAccessor` | Secrets `controleit-app-secret`, `controleit-database-url`, `controleit-entra-client-secret`, `controleit-gandi-token`, `controleit-sage-api-key` | Lecture des secrets à l'exécution | ☐ |
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
| `controleit-gandi-token` | Jeton d'accès personnel Gandi (modèle « Services Gandi ») : **expire au plus tard au bout d'un an**, à renouveler dans Gandi puis ici |
| `controleit-sage-api-key` | Clé `X-API-KEY` de l'API A3SreportingSage (modèle « Accès Sage »), dédiée à ControleIT dans la table `ApiKeys` de fimapi2 |

Aucun secret n'est dans le code ni dans le dépôt GitHub.
