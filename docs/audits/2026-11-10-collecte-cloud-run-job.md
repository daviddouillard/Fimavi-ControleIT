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
