# Audit — Modèle « Accès aux boîtes partagées » (2026-11-18)

## Périmètre

- **Nouveau modèle de contrôle** `exchange-shared-mailboxes` (`server/controls/exchange-shared-mailboxes/`) : à la création de la session, on coche les tenants à analyser parmi les tenants actifs des paramètres. Pour chaque boîte partagée, une ligne par titulaire et par droit :
  - **Accès total** : FullAccess explicite, hors hérité et refus (`Get-MailboxPermission`) ;
  - **Envoyer en tant que** : SendAs autorisé (`Get-RecipientPermission`) ;
  - **Envoyer de la part de** : GrantSendOnBehalfTo (`Get-Mailbox`).
  - Les comptes système (NT AUTHORITY\SELF…) sont ignorés. Le titulaire est retrouvé dans l'annuaire synchronisé pour afficher son nom. Pas de valideur suggéré (choix de l'IT).
- **Client Exchange** (`server/utils/exchange.ts`) : service `InvokeCommand` d'Exchange Online, le même que celui du module PowerShell officiel. Jeton applicatif `https://outlook.office365.com/.default` (permission `Exchange.ManageAsApp`) obtenu avec le secret existant. Aucun certificat, aucun PowerShell dans l'image.
- **Paramètres** : bouton « Tester Exchange » par tenant. Il compte les boîtes partagées et vérifie la lecture des droits de la première.
- **Consentement** : le lien de consentement passe au point d'accès v1 (`/adminconsent`). Il accorde toutes les permissions déclarées sur l'app registration, Graph et Exchange, alors que la v2 ne couvrait que Graph.
- **Affichage** : tableau de la session (Tenant, Boîte partagée, Titulaire et droit ; pas de colonne « Partagé par »), page du valideur, liste des accès à retirer, filtres et recherche. Avancement de la lecture : boîtes lues sur le total.
- **Email** : objet et message par défaut propres aux boîtes partagées (« Je vous ai confié des accès à des boîtes aux lettres partagées… »).

## Revue de sécurité

- **Moindre privilège** :
  - lecture seule : le code n'accepte que `Get-Mailbox`, `Get-MailboxPermission` et `Get-RecipientPermission`. Toute autre commande (Set-, Add-, Remove-…) est refusée avant l'envoi (test unitaire) ;
  - droits Exchange effectifs : rôle Entra « Lecteur général », en lecture seule. **Risque résiduel** : ce rôle lit toute la configuration Microsoft 365 du tenant, sans le contenu des emails ni des fichiers. Piste plus restreinte : groupe de rôles Exchange limité à « View-Only Recipients », à valider une fois le module en service.
- **Fuite de jeton (SSRF)** : le jeton n'est envoyé qu'à `https://outlook.office365.com/adminapi/beta/<tenant GUID>/InvokeCommand`, liens de pagination compris. Un lien externe est refusé (test). L'ID de tenant doit être un GUID.
- **Point d'accès non documenté** : il peut évoluer sans préavis. Le bouton « Tester Exchange » et le compte rendu de collecte signalent toute panne, sans bloquer les autres tenants.
- **Journaux et erreurs** : seuls le statut HTTP et le code d'erreur sont conservés, jamais le détail Exchange (qui cite des objets), le jeton ou le secret.
- **Autorisation et IDOR** : la création de session vérifie que les tenants cochés existent et sont actifs ; seules les données du modèle choisi sont enregistrées. La route de test Exchange est réservée aux admins et ne renvoie qu'un nombre de boîtes.
- **XSS** : nouvelles données affichées par interpolation Vue dans les composants existants, sans `v-html`.
- **Consentement v1** : il accorde toutes les permissions déclarées sur l'app registration. `Mail.Send` ne doit donc jamais y être déclaré (règle déjà en vigueur, §3 des droits).
- **`npm audit --omit=dev`** : 62 vulnérabilités (7 modérées, 55 élevées), contre 14 précédemment.
  - La hausse vient d'**un seul** avis publié depuis, sur `picomatch` ≤ 4.0.7 (ReDoS sur des motifs de fichiers). Il remonte à travers tout l'outillage Nuxt (kit, Vite, Rollup, unplugin…).
  - Aucune version corrigée n'est publiée.
  - `picomatch` n'est **pas** dans le serveur déployé (`.output`) et ne sert qu'à la compilation, avec des motifs fixes du projet. Il n'est donc pas exploitable en production.
  - À revoir dès qu'une version corrigée sort.

Aucun constat ouvert sur le code livré.

## TNR

- `npm run typecheck` : OK.
- `npm run test` : 113/113. Nouveaux tests :
  - unitaires : filtrage des droits, ligne produite, client Exchange (URL, en-têtes, pagination, commandes refusées, lien externe refusé, erreurs) ;
  - intégration : collecte complète sur PGlite, tenant en échec isolé, email propre au modèle.
- `npm run test:e2e` : 25/25. Nouveau test : bouton « Tester Exchange », formulaire de création avec les tenants pré-cochés.

## Mise en service (à faire par l'IT, dans chaque tenant)

Voir `docs/droits-et-autorisations.md` §3.2 :
1. ajouter la permission `Exchange.ManageAsApp` ;
2. donner le consentement administrateur ;
3. attribuer le rôle « Lecteur général » à l'application ;
4. cliquer sur « Tester Exchange ».

## Exception temporaire sur l'audit des dépendances (décision du 2026-11-18)

- Le pipeline bloquait le déploiement à cause de l'avis `picomatch` **GHSA-fc5q-39xc-vjpf** (élevé), sans version corrigée.
- Décision de l'IT : accepter cet avis **jusqu'au 2026-12-31**, puisque `picomatch` est absent du serveur déployé.
- Mise en œuvre : `scripts/audit-gate.mjs` (étape CI et `npm run audit:deps`). Il bloque tout autre avis élevé ou critique. L'exception redevient bloquante à son expiration, et le script signale quand elle n'est plus utile.
- Vérification locale : seul cet avis est concerné ; résultat « Aucun avis bloquant ».

## Complément : renommer un tenant (2026-11-18)

- Crayon à côté du nom de chaque tenant dans les paramètres. Il utilise la route existante `PATCH /api/admin/settings/connections/:id`, réservée aux admins. Le nom est validé par Zod (2 à 100 caractères) et le changement est tracé dans l'audit (`settings.connection_update`). Le nom est affiché par interpolation Vue, sans `v-html`.
- TNR : typecheck OK, vitest 113/113, e2e 25/25 (le test des paramètres couvre le renommage).
