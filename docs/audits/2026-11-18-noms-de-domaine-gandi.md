# Audit — Modèle « Noms de domaine (Gandi) » (2026-11-18)

## Périmètre

- **Nouveau modèle de contrôle** `gandi-domains` (`server/controls/gandi-domains/`) :
  - à la création de la session, lecture de tous les noms de domaine de l'organisation Gandi du jeton ;
  - une ligne par domaine : échéance (`dates.registry_ends_at`), renouvellement automatique, titulaire, extension ;
  - les échéances les plus proches viennent en premier ;
  - pas de valideur suggéré.
- **Client Gandi** (`server/utils/gandi.ts`) :
  - API v5, `GET /v5/domain/domains` paginé (100 par page) ;
  - jeton d'accès personnel lu dans `NUXT_GANDI_TOKEN` ;
  - nouvelles tentatives sur 429, 503 et 504.
- **Réponses selon le modèle** (`shared/decisions.ts`) :

  | Modèle | Conserver | Arrêter |
  |---|---|---|
  | SharePoint | Valider le partage | Arrêter le partage |
  | Boîtes partagées | Conserver l'accès | Retirer l'accès |
  | Noms de domaine | Renouveler le domaine | Ne plus renouveler |

  Les réponses enregistrées (`keep`, `remove`, `reassign`) ne changent pas.
- **Remédiation** : une réponse « Ne plus renouveler » crée une action dans le pot commun de l'IT, renommé « Actions à faire ». L'IT désactive alors le renouvellement à la main dans Gandi.
- **Paramètres** :
  - carte « Gandi » indiquant si le jeton est configuré ;
  - bouton « Tester Gandi », qui ne renvoie que le nombre de domaines.
- **Email** : objet et message par défaut propres aux noms de domaine.
- **Déploiement** : le secret `controleit-gandi-token` n'est ajouté au service et au Job que si la variable GitHub `GANDI_TOKEN_SECRET` est posée. Sans elle, le déploiement continue et le modèle signale l'absence de jeton.

## Revue de sécurité

- **Moindre privilège** :
  - l'application ne fait que des lectures (GET) et ne modifie jamais rien chez Gandi ;
  - jeton limité à une organisation, avec le seul droit de voir les domaines (§3.3 des droits) ;
  - durée courte : 1 an au plus, imposé par Gandi.
- **Fuite de jeton (SSRF)** :
  - le jeton n'est envoyé qu'à `https://api.gandi.net/v5/` (vérification avant chaque appel) ;
  - l'URL est construite par l'application, sans lien de pagination fourni par la réponse.
- **Secret** :
  - jamais renvoyé au navigateur : les paramètres exposent seulement `gandiConfigured` (booléen) ;
  - jamais journalisé : en cas d'erreur, seul le statut HTTP est conservé.
- **Autorisation** :
  - la route de test est réservée aux admins (`requireAdmin`) ;
  - la création de session reste réservée aux admins et validée par Zod ;
  - le modèle n'accepte aucune option : la configuration enregistrée est `{}`.
- **Validation** : chaque domaine reçu est validé par Zod. Une réponse inattendue fait échouer la lecture et la signale dans le compte rendu.
- **XSS** : les données Gandi sont affichées par interpolation Vue, sans `v-html`.
- **Pagination** : un garde-fou limite la lecture à 1 000 pages, contre une boucle sans fin.
- **`npm run audit:deps`** : aucun avis bloquant. L'exception datée `picomatch` court jusqu'au 2026-12-31.

Aucun constat ouvert sur le code livré.

## TNR

- `npm run typecheck` : OK.
- `npm run test` : 120/120. Nouveaux tests :
  - client Gandi : pagination, jeton envoyé à la seule API Gandi, erreurs sans détail ;
  - ligne produite ;
  - vocabulaire par modèle ;
  - collecte sur PGlite, dont le jeton refusé.
- `npm run test:e2e` : 26/26. Nouveau test : jeton non configuré signalé, création de session sans site ni tenant.

## Mise en service (à faire par l'IT)

1. Dans Gandi, créer un jeton d'accès personnel pour l'organisation, avec le seul droit de voir les noms de domaine et la durée la plus courte acceptable.
2. Le ranger dans Secret Manager (`controleit-gandi-token`) et donner l'accès au compte `controleit-run`.
3. Poser la variable GitHub `GANDI_TOKEN_SECRET=controleit-gandi-token`, puis redéployer.
4. Cliquer sur « Tester Gandi » dans les paramètres.
