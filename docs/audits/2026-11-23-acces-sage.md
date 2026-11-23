# Audit — Modèle « Accès Sage » (2026-11-23)

## Périmètre

### API interne A3SreportingSage (fimapi2, hors de ce dépôt)

- **Nouvelle route** `GET /DroitAcces/Get_DroitAccesGroupe`, en lecture seule :
  - elle lit `GROUPE.dbo.LOGINS_SAGE` avec le compte SQL `SQL_ControlIT`, qui n'a que le droit `SELECT` ;
  - la liste de colonnes est explicite : les mots de passe Sage (`PR_Pwd`, `PR_PWDCrypte`) ne sont jamais lus.
- **Mots de passe SQL sortis du code** :
  - `Class_BDD_Groupe.cs` et `appsettings.json` ne contiennent plus de chaîne de connexion ;
  - les connexions `Sage`, `Groupe` et `DefaultConnection` sont des variables d'environnement IIS (`applicationHost.config`, lisible par les seuls administrateurs) ;
  - l'API refuse de démarrer s'il en manque une.
- **Clé `X-API-KEY` dédiée** à ControleIT :
  - créée dans la table `ApiKeys` (`Utilisateur = 'A3SreportingSage'`) ;
  - tirée au hasard par `CRYPT_GEN_RANDOM(32)` ;
  - rangée dans Secret Manager (`controleit-sage-api-key`) sans être affichée.
- **Vérifié** :
  - route Commande (AnalyseDevis) : 200 ;
  - nouvelle route : 200, 612 comptes, aucune colonne de mot de passe dans la réponse ;
  - appel sans clé : 401.

### ControleIT

- **Client `server/utils/sageApi.ts`** :
  - adresse de base en `NUXT_SAGE_API_URL`, HTTPS obligatoire, sans identifiant ni paramètre ;
  - clé envoyée à cette seule adresse, construite avec un chemin fixe ;
  - redirections refusées, délai de 60 s, trois tentatives au plus ;
  - réponse validée par Zod, 50 000 lignes au plus.
- **Modèle `server/controls/sage-access/`** :
  - une ligne par compte Sage et par dossier ;
  - personne retrouvée dans l'annuaire Entra par `onPremisesSamAccountName`, à défaut le début de l'UPN ;
  - groupes Entra Sage de la personne (`transitiveMembers`, sous-groupes compris) ;
  - N+1 suggéré comme valideur ;
  - écart « Compte Sage sans groupe Entra » placé en tête ;
  - si un groupe est illisible, aucun écart n'est signalé.
- **Route admin `POST /api/admin/settings/sage/test`** : renvoie le nombre de comptes, de dossiers et de membres par groupe.
- **Paramètres et textes** : carte « Sage » dans les paramètres, vocabulaire « Valider l'accès » / « Retirer l'accès », email par défaut, écrans admin et valideur.
- **Déploiement** :
  - secret `NUXT_SAGE_API_KEY` posé par le pipeline si la variable `SAGE_API_KEY_SECRET` existe ;
  - sortie par VPC et Cloud NAT si la variable `VPC_EGRESS_NETWORK` existe (`infra/gcp-nat.ps1`).
- **Nouvelle permission Graph** : `GroupMember.Read.All` (application), à accorder avec le consentement administrateur.

## Revue de sécurité

Revue du diff par un agent indépendant, avec les règles du §4 de CLAUDE.md et le Top 10 OWASP : aucun constat élevé ou moyen.

| Point | Constat |
|---|---|
| Fuite de la clé | Adresse fixe, redirections refusées. Messages d'erreur fixes, sans la clé ni le corps de la réponse. Le navigateur ne reçoit que `sageConfigured` (booléen) |
| SSRF | Aucune entrée utilisateur ne compose l'URL |
| Autorisation | Route de test protégée par `requireAdmin` |
| Injection OData | Nom de groupe issu de la configuration, apostrophes doublées, filtre encodé |
| XSS | Aucun `v-html` ; données affichées par interpolation |
| Données des valideurs | `suggestedValidatorId` et `suggestedValidatorName` sont déjà retirés (`ADMIN_ONLY_FIELDS`) ; aucun mot de passe n'est copié dans les lignes |
| Taille de réponse (faible) | **Corrigé** : 50 000 lignes au plus |
| Appels N+1 séquentiels (faible) | Accepté : environ 150 personnes, exécutés dans le Job de collecte |

Autres points :
- `npm run audit:deps` : aucun avis bloquant. L'exception `picomatch` (GHSA-fc5q-39xc-vjpf), devenue inutile, est retirée.
- **Reste à faire, côté A3SreportingSage** :
  - changer les mots de passe de `SQL_a3sreporting_api` et `s_lecteur_apikey`, longtemps en clair dans les fichiers ;
  - supprimer les sauvegardes qui les contiennent.

## TNR

- `npm run typecheck` : OK.
- `npm run test` : 138/138. Nouveaux tests :
  - client de l'API : adresse, clé, refus, réseau, aucun mot de passe repris ;
  - lignes, rapprochement de l'annuaire, groupes configurés, vocabulaire, email ;
  - collecte : écarts en tête, N+1 suggéré, doublons ;
  - groupes illisibles sans écart inventé ;
  - API injoignable.
- `npm run test:e2e` : 27/27. Nouveau test : carte Sage non configurée, création d'une session « Accès Sage ».
