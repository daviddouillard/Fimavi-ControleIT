# Audit — Collecte exécutée dans un Job Cloud Run (2026-11-10)

## Contexte

Le 10/11, deux collectes ont été déclarées « interrompues ». D'après les journaux Cloud Run, la collecte tournait en tâche de fond dans l'instance du service. Le navigateur a cessé d'interroger le serveur à 9h09 (poste verrouillé). Cloud Run a alors arrêté l'instance, devenue sans requête (`--min-instances 0`), et la collecte s'est arrêtée avec elle.

## Périmètre

- Nouveau Job Cloud Run `controleit-collect` : même image que le service, 1 tâche, 0 relance, délai maximal 24 h.
- L'application lance une exécution par collecte via l'API Cloud Run v2 (`jobs/…:run`). Elle passe `NUXT_COLLECTION_RUN_ID` en surcharge et s'authentifie avec le jeton du compte de service, obtenu auprès du serveur de métadonnées.
- Le plugin serveur `collection-job` : en mode Job, il exécute la collecte puis arrête le conteneur.
- Sans `NUXT_COLLECTION_JOB` (développement, tests), la collecte tourne dans le processus, comme avant.
- Infrastructure :
  - `infra/gcp-collect-job.ps1` crée le Job s'il n'existe pas et accorde le droit de lancement.
  - Le pipeline déploie le Job avant le service.

## Revue de sécurité

- **Authentification sortante** : le jeton du compte de service n'est envoyé qu'à `https://run.googleapis.com/v2/`. Le nom du Job (`NUXT_COLLECTION_JOB`) est validé par une expression stricte (`projects/…/locations/…/jobs/…`, sans `/`, `.` ni schéma) avant tout appel. Si le nom est invalide, aucun appel réseau n'est fait.
- **Moindre privilège** :
  - `controleit-run` reçoit `roles/run.jobsExecutorWithOverrides` sur ce seul Job, pas sur le projet.
  - Le Job ne reçoit que les secrets nécessaires : URL de la base et secret Entra pour Graph. Il ne reçoit pas `NUXT_APP_SECRET`, car il ne sert aucune session.
  - Le Job n'a aucune URL d'entrée.
- **Entrées** : l'identifiant de collecte est un UUID généré par la base, revalidé (`z.uuid()`) dans le Job. Une collecte inconnue ou qui n'est plus « en cours » n'est pas exécutée. Une exécution rejouée ne peut donc pas ajouter de lignes.
- **Autorisation** : le lancement reste réservé aux administrateurs (routes inchangées) et limité à une collecte en cours par session (index unique existant).
- **Échec de lancement** : la collecte est marquée en échec (« Lancement de la collecte impossible ») et la session peut être relancée. Le journal contient le code HTTP, jamais le jeton.
- **Coût / déni de service** : une exécution par collecte, limitée aux administrateurs, avec un délai maximal de 24 h et 0 relance.
- Les garde-fous existants sont conservés : session verrouillée `FOR SHARE`, collecte `FOR UPDATE`, signe de vie (heartbeat) et délai d'interruption de 10 min.
- `npm audit --omit=dev` : aucune dépendance ajoutée, résultat inchangé (aucune vulnérabilité haute).

Aucun constat ouvert.

## TNR

- `npm run typecheck` : OK
- `npm run test` : 71/71. Deux tests ajoutés :
  - lancement du Job (en-têtes, URL, surcharge) et exécution unique ;
  - échec de lancement et nom de Job invalide.
- `npm run test:e2e` : 23/23
- Build lancé localement en mode Job : le conteneur exécute la collecte puis s'arrête (code 1 en cas d'erreur).

## Correctif post-déploiement

Le premier essai en production a échoué avec « Lancement de la collecte impossible ». Les journaux indiquaient : jeton du compte de service indisponible (404). L'adresse du serveur de métadonnées était erronée (`instance/service-account/token`) ; la bonne adresse est `instance/service-accounts/default/token`. Le test vérifie désormais cette adresse.

TNR après correctif : typecheck OK, 71/71, 23/23.

## Correctif : collecte déclarée interrompue à tort

Sur un gros site, la collecte a été déclarée « interrompue » au bout de 10 minutes alors que son Job tournait toujours. Le signe de vie n'était mis à jour qu'à chaque page d'éléments parcourue, pas pendant l'analyse des permissions des éléments partagés. Le Job a continué sans plus rien pouvoir enregistrer, et une relance a fait tourner deux Jobs en parallèle.

Corrections :
- La collecte enregistre un signe de vie toutes les minutes, quelle que soit l'étape en cours.
- Une collecte qui n'est plus « en cours » (interrompue, ou session sortie du brouillon) s'arrête au prochain point de contrôle. Les erreurs d'un site ne masquent plus cet arrêt.
- L'avancement de l'analyse des permissions (x/y) et le nombre de lignes déjà présentes s'affichent sur la session.

TNR : typecheck OK, 73/73 (2 tests ajoutés : signe de vie pendant une longue étape, arrêt d'une collecte interrompue), 23/23.

## Correctif : comptes membres du tenant remontés comme externes

Les comptes d'administration du tenant (adresse hors de la liste des domaines internes, par exemple en onmicrosoft.com) remontaient comme des partages externes. La règle ne regardait que le domaine de l'adresse.

Un compte membre du tenant n'est plus jamais considéré comme externe, quel que soit son domaine. Il est reconnu de deux façons :
- son nom de connexion SharePoint est de la forme `i:0#.f|membership|…`, sans `#ext#` ;
- ou son identifiant Entra figure dans l'annuaire synchronisé du tenant du site, qui ne contient que les comptes « Member ».

Restent externes :
- les invités (`#ext#`, `urn:spo:guest`) hors des domaines du groupe ;
- les liens « Tout le monde ».

Sécurité : la règle ne fait que réduire les lignes remontées, à partir de données fournies par Graph et l'annuaire. Pas de nouvelle entrée utilisateur.

TNR : typecheck OK, 76/76 (3 tests ajoutés), 23/23.

## Évolution : détection complète des partages (Sites.Selected, contrôle total par site)

Constat : sur 6 sites, aucun partage de dossier ou de fichier n'a été remonté. Sans en-tête particulier, la facette `shared` renvoyée par le delta Graph ne signale pas les éléments qui ont leurs propres permissions. D'après la documentation Microsoft, le traitement des permissions par delta exige le contrôle total.

Décision de l'administrateur IT : accorder le **contrôle total uniquement sur les sites choisis** (`Sites.Selected` + rôle `fullcontrol`), plutôt que `Sites.FullControl.All` sur tout le tenant.

- Collecte :
  - delta avec `Prefer: hierarchicalsharing`, qui marque tout élément à permissions propres, même sans lien ;
  - vérification du contrôle total par site. Un site en lecture seule est signalé en erreur de site, sans arrêter la collecte.
- Bouton « Tester » : indique « Accès OK » (contrôle total) ou « Lecture seule ».
- `infra/grant-site-fullcontrol.ps1` :
  - octroi site par site par un administrateur SharePoint (Microsoft Graph PowerShell, connexion déléguée) ;
  - URL validée (`*.sharepoint.com`) ;
  - idempotent.

Sécurité :
- Le droit d'écriture est limité aux sites désignés. Le code n'appelle Graph qu'en lecture (`GET`), à part `sendMail`.
- L'octroi n'est pas automatisable par l'application, qui ne détient pas `Sites.FullControl.All`.
- Le jeton reste limité à `https://graph.microsoft.com/v1.0/`.
- À réévaluer après validation : retirer `Sites.Read.All` si `Sites.Selected` suffit sur les sites désignés.

TNR : typecheck OK, 78/78 (tests ajoutés : en-tête hierarchicalsharing, site en lecture seule, erreur de vérification), 23/23.

## Ergonomie : tableau des lignes et icônes

- Le texte des cellules ne passait pas à la ligne alors que leur largeur était limitée : il débordait sur les colonnes voisines.
- Nouvelle mise en page :
  - page élargie jusqu'à 1 920 px ;
  - colonne Ressource : icône selon le type, nom en gras, chemin en dessous, lien SharePoint ;
  - colonne Bénéficiaire : nom, adresse, badges d'accès et de droit ;
  - commentaire limité à 3 lignes, avec le texte complet au survol.
- Icônes absentes en production : le module d'icônes appelait l'API Iconify, bloquée par la CSP (`connect-src 'self'`). Les icônes sont désormais servies par l'application :
  - collection `@iconify-json/lucide` installée ;
  - réglages `serverBundle: 'local'`, `clientBundle.scan` et `fallbackToApi: false`.

  La CSP est inchangée et aucun appel extérieur n'est fait.

Sécurité :
- Pas de `v-html`. Les liens ne pointent que vers `https://*.sharepoint.com` (`sharepointLink`), avec `rel="noopener noreferrer"`.
- Dépendance ajoutée : `@iconify-json/lucide`, des données d'icônes uniquement. `npm audit --omit=dev` est inchangé : 13 vulnérabilités, aucune haute.

TNR : typecheck OK, 78/78, 23/23. Rendu vérifié par captures en 1 440 et 1 920 px, avec des données réalistes.
