# Audit — Auteur des partages et N+1 suggéré (2026-11-12)

## Contexte

Le diagnostic `infra/diag-share-authors.ps1`, en lecture seule, a été lancé sur le site TSI :
- 150 éléments partagés, 1 444 permissions et 69 liens analysés ;
- **aucun auteur** dans les données SharePoint : `shared.sharedBy` à 0, `invitation.invitedBy` à 0, aucun champ « créé par » sur les liens.

Seul le journal d'audit Microsoft 365 indique qui a créé un partage.

## Périmètre

- **Collecte** :
  - au démarrage, une recherche est lancée par tenant dans le journal d'audit (API Graph `security/auditLog/queries`, v1.0). Elle couvre les 180 derniers jours et se limite aux opérations de création de partage externe : `AnonymousLinkCreated`, `SecureLinkCreated`, `AddedToSecureLink`, `SharingInvitationCreated` et `SharingSet` ;
  - une fois les sites parcourus, la collecte attend le résultat (avec signe de vie toutes les 30 s, 90 min au plus), puis rapproche chaque ligne d'un événement.
- **Règle de rapprochement**, sur la même adresse d'élément (`objectUrl`, reconstruite à partir de la bibliothèque et du chemin) :
  - le plus ancien événement qui cite le bénéficiaire (son adresse), ou un lien anonyme pour « Tout le monde » : auteur **sûr** ;
  - à défaut, le plus ancien partage de l'élément : auteur **probable**, signalé par un badge ;
  - sans événement (partage de plus de 180 jours, ou audit inaccessible) : « Inconnu ».
- **N+1 suggéré** : responsable de l'auteur dans Entra (`users/{upn}/manager`, permission `User.Read.All` déjà accordée), retrouvé dans l'annuaire synchronisé. Bouton « Assigner au N+1 suggéré » sur les lignes sélectionnées. C'est une simple suggestion : l'admin choisit toujours les lignes.
- **Affichage** :
  - colonne « Partagé par » (triable, incluse dans la recherche), avec la date et le N+1 suggéré ;
  - auteur aussi visible du valideur dans la fenêtre de réponse ;
  - avancement de la collecte : « recherche des auteurs… », puis « auteur trouvé pour N ligne(s) ».
- **Résilience** : sans la permission d'audit, ou si la recherche échoue, la collecte se termine quand même. Un message explicite apparaît dans le compte rendu (« Journal d'audit (tenant) : permission … à accorder »).

## Revue de sécurité

- **Moindre privilège** : permission applicative `AuditLogsQuery-SharePoint.Read.All`, en lecture seule et limitée à l'audit SharePoint. Elle donne accès ni à Exchange, ni à Entra, ni à Teams. Aucune écriture.
- **Graph** :
  - les appels passent par le client existant, qui n'envoie le jeton qu'à `https://graph.microsoft.com/v1.0/`, liens de pagination compris ;
  - les identifiants de requête sont encodés (`encodeURIComponent`) ;
  - les réponses sont validées par Zod.
- **Données** :
  - les champs ajoutés aux lignes (`sharedBy`, `sharedAt`, `sharedByCertain`, `suggestedValidatorId`, `suggestedValidatorName`, `objectUrl`) sont fusionnés en JSONB par une requête paramétrée (`data || $1::jsonb`) ;
  - la fusion n'a lieu que pendant une collecte en cours et une session en brouillon, avec les mêmes verrous que l'ajout de lignes.
- **Confidentialité (IDOR et fuite)** : `/api/me/checks` retire `suggestedValidatorId`, `suggestedValidatorName` et `objectUrl` avant l'envoi au valideur (test E2E). Le valideur voit l'auteur du partage, information utile à sa décision.
- **Assignation au N+1** : elle utilise la route d'assignation existante, réservée à l'admin. Le serveur revérifie que le valideur est un compte actif.
- **XSS** : composant `ShareAuthor` rendu par interpolation Vue, sans `v-html`.
- **`npm audit --omit=dev`** : 14 vulnérabilités (2 faibles, 12 modérées), inchangé. Aucune dépendance ajoutée.

Aucun constat ouvert.

## Limites connues

- Rétention de l'audit standard : 180 jours. Les partages plus anciens restent « Inconnu ».
- La recherche d'audit prend plusieurs minutes côté Microsoft, ce qui allonge la collecte d'autant.
- Les noms des champs détaillés de l'audit ne sont pas documentés de façon stable. Le rapprochement « sûr » recherche donc l'adresse du bénéficiaire dans tout le contenu de l'événement. À vérifier sur une vraie collecte, puis ajuster si besoin.

## Complément : message précis du bouton « Tester » (raccordement d'un tenant filiale)

- Un jeton refusé par Entra est désormais distingué d'un site refusé par SharePoint :
  - jeton refusé : le message donne le code `AADSTS…` et sa cause (ID de tenant introuvable, application non consentie dans le tenant, secret expiré, accès conditionnel) ;
  - site refusé : le message donne le statut HTTP et le code Graph (ex. `accessDenied`).
- Le message est aussi écrit dans les journaux du serveur.
- **Sécurité** : seuls le code d'erreur Microsoft et le statut sont conservés, jamais le corps de la réponse, le jeton ou le secret. Tests unitaires `tests/unit/graph-diagnostics.test.ts`.

## TNR

- `npm run typecheck` : OK
- `npm run test` : 93/93. Nouveaux tests :
  - unitaires : `tests/unit/sharepoint-authors.test.ts` (requête 180 jours, permission manquante, attente, lecture paginée, rapprochement sûr, probable ou absent, N+1) ;
  - intégration : auteur, N+1 de l'annuaire et fusion des données dans la ligne.
- `npm run test:e2e` : 24/24. Colonne « Partagé par », N+1 suggéré, bouton d'assignation au N+1, suggestion non transmise au valideur.
