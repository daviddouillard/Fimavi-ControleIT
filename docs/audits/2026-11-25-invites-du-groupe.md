# Audit — Option « Inclure les invités des domaines du groupe » (2026-11-25)

## Contexte

L'administrateur voulait voir tous les partages SharePoint. Pour cela, il avait vidé la liste des domaines internes, et la création de session était alors bloquée.

Cette liste sert à deux choses :
- **écarter des partages** les invités de ces domaines ;
- **autoriser la connexion** : sans elle, seuls les administrateurs IT peuvent se connecter, et les valideurs sont refusés.

Le blocage est donc conservé. On ajoute à la place une option à la création de la session.

## Périmètre

- `shared/schemas/session.ts` : champ facultatif `includeGroupGuests` (booléen, validé par Zod).
- `server/api/admin/sessions/index.post.ts` : l'option n'est enregistrée dans la configuration que pour le modèle SharePoint, et seulement si elle est cochée.
- `server/controls/sharepoint-external/index.ts` : `exemptDomains`. Avec l'option, aucun domaine n'exempte un invité. Tous les comptes invités (#ext#, urn:spo:guest) et les liens « Tout le monde » remontent.
- Les membres du tenant restent écartés (nom de connexion « membership » sans #ext#, ou présents dans l'annuaire synchronisé).
- `server/services/collection.ts` : le message de blocage explique pourquoi les domaines internes sont nécessaires.
- `app/pages/admin/index.vue` : case à cocher dans la fenêtre de création.

## Constats de sécurité

- **Route** : réservée aux administrateurs (`requireAdmin`), sans nouvelle route. L'entrée est un booléen validé par Zod.
- **IDOR** : aucun identifiant nouveau.
- **Contrôle d'accès inchangé** : la liste des domaines internes reste obligatoire pour la connexion des valideurs.
- **Données** : l'option est tracée dans l'audit `session.create`, qui enregistre la configuration. Aucune écriture dans SharePoint. Aucune donnée nouvelle n'est collectée, seulement moins de filtrage.
- **XSS** : textes fixes, pas de `v-html`.
- **Dépendances** : `npm run audit:deps`, aucun avis bloquant.

## TNR

- typecheck OK.
- `npm run test` : 141/141. Nouveau test : invité d'un domaine interne retenu avec l'option, membre du tenant toujours écarté.
- `npm run test:e2e` : 27/27.
