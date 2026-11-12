# Audit — Ergonomie des écrans et fenêtre d'envoi des emails (2026-11-12)

## Périmètre

- **Tableau de bord** :
  - indicateurs avec icônes ;
  - une carte par session (avancement en %, compteurs en attente, sans valideur, à réattribuer et à retirer) ;
  - accès à retirer présentés avec la ressource et le bénéficiaire.
- **Page du valideur** :
  - tableau lisible (ressource, bénéficiaire, réponse en badge) ;
  - fenêtre de réponse aérée : cartes ressource et bénéficiaire, trois choix en tuiles avec icônes, boutons Annuler et Enregistrer.
- **Page de session** : valideurs présentés en cartes, historique des emails avec statut et motif d'échec.
- **Fenêtre « Prévenir les valideurs »** :
  - destinataires pré-cochés (valideurs ayant des lignes en attente) ;
  - objet et message modifiables ;
  - aperçu de l'email.
  - Le nombre de lignes et le lien vers l'application sont toujours ajoutés.
- Composants partagés `ShareResource` et `ShareBeneficiary`.
- **Message d'erreur d'envoi explicite** : un refus Exchange (401/403) indique que l'autorisation « RBAC for Applications » de la boîte d'envoi manque. Une boîte introuvable (404) est aussi signalée.

## Cause de l'échec d'envoi constaté

L'expéditeur `helpdesk@fimavi.com` est bien configuré (`NUXT_MAIL_SENDER`). L'autorisation Exchange « RBAC for Applications », qui doit permettre à l'application d'envoyer depuis cette seule boîte, n'a pas encore été mise en place. Microsoft Graph refuse donc l'envoi (403). Il s'agit d'une action d'administration Exchange, pas d'une correction de code.

## Revue de sécurité (OWASP)

- **Injection / XSS dans les emails** :
  - l'objet et le message saisis par l'admin sont du texte brut ;
  - le message est échappé ligne par ligne avant d'être mis en HTML (test : une balise `<img onerror>` ressort échappée) ;
  - l'objet est refusé s'il contient un retour à la ligne, pour éviter toute injection d'en-tête ;
  - longueurs bornées à 200 caractères pour l'objet et 5 000 pour le message (Zod, client et serveur).
- **Destinataires** : toujours filtrés côté serveur. Seuls les valideurs de la session ayant des lignes en attente, avec un compte actif, peuvent recevoir l'email ; 100 destinataires au plus. L'interface ne fait que proposer la liste.
- **Autorisation** : route d'envoi inchangée, réservée à l'admin. Aucune nouvelle route.
- **Affichage** : aucun `v-html` ; l'aperçu de l'email est rendu par interpolation Vue. Les liens SharePoint sont limités à `https://*.sharepoint.com`, avec `rel="noopener noreferrer"`.
- **Journalisation** : les messages d'échec enregistrés ne contiennent ni jeton ni réponse brute de Graph.
- **`npm audit --omit=dev`** : 14 vulnérabilités (2 faibles, 12 modérées), aucune haute.
  - Nouvelle alerte modérée sur `node-forge`, dépendance de `listhen` (serveur de développement Nuxt), non utilisé en production.
  - Aucune dépendance ajoutée par cette livraison.

Aucun constat ouvert.

## TNR

- `npm run typecheck` : OK
- `npm run test` : 80/80. Tests ajoutés :
  - objet et message personnalisés échappés, nombre de lignes et lien toujours présents ;
  - objet multiligne et message vide refusés.
- `npm run test:e2e` : 23/23. Le parcours d'envoi passe désormais par la fenêtre de préparation (destinataire pré-coché, objet par défaut).
- Rendu vérifié par captures en 1 440 px, avec des données réalistes : tableau de bord, session, fenêtre d'email, page du valideur, fenêtre de réponse.

## Autorisation Exchange (fait le 2026-11-12)

RBAC for Applications configuré dans Exchange Online :
- principal de service `ControleIT` déclaré ;
- périmètre `ControleIT-Helpdesk` limité à `helpdesk@fimavi.com` ;
- rôle `Application Mail.Send` assigné sur ce périmètre.

`Test-ServicePrincipalAuthorization` donne `InScope = True` pour helpdesk. Aucune permission Mail.Send n'a été ajoutée dans Entra.

## Correctif : bouton email et recherche de valideur

- **Bouton « Préparer l'email »** toujours actif, pour permettre les relances. La fenêtre explique pourquoi l'envoi est impossible : session en brouillon ou clôturée, aucun valideur en attente, aucune ligne assignée. Le bouton Envoyer reste désactivé dans ces cas et le serveur refuse toujours l'envoi hors session ouverte. Destinataires : tous les valideurs ayant au moins une ligne sans réponse ; ceux qui sont à jour sont listés comme non relancés.
- **Recherche de valideur sans résultat en production.** La limite de requêtes de `nuxt-security` (150 requêtes par 5 min par IP par défaut) comptait aussi les fichiers statiques de l'application et est partagée par toute l'équipe derrière la même IP. Les recherches tombaient en 429 et la liste restait vide sans message.
  - Fichiers `/_nuxt/**` exclus de la limite.
  - Limite portée à 1 500 requêtes par 5 min et par IP. Elle protège toujours contre un abus massif. La connexion passe par Entra ID, il n'y a donc pas de mot de passe local à protéger contre la force brute.
  - Une recherche en échec affiche désormais un message.

TNR : typecheck OK, `npm run test` 80/80, `npm run test:e2e` 23/23. Le test E2E vérifie la fenêtre en brouillon et la recherche à 2 lettres.
