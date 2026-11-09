# Audit — Collecte SharePoint, multi-tenant, réponses à trois choix, emails (2026-11-09)

## Périmètre

- Connexion Entra **multi-tenant** (tenant principal + tenants raccordés), annuaire synchronisé par tenant.
- **Paramètres** : domaines internes, tenants raccordés (lien de consentement), sites SharePoint.
- **Collecte Graph** des partages externes (en arrière-plan) à la création de la session ; suppression de l'import CSV.
- Réponse **Mauvaise attribution** ; commentaire toujours obligatoire.
- **Emails** aux valideurs via Graph `sendMail` (boîte helpdesk), historique des envois.
- Migration `0003_multi_tenant_collection`, droits BDD, déploiement Cloud Run (`--no-cpu-throttling`).

## Revue de sécurité (OWASP Top 10)

Revue indépendante du diff complet. Aucun constat de gravité haute. Points vérifiés conformes :

- Toutes les nouvelles routes exigent le rôle admin ; anti-IDOR des réponses inchangé.
- id_token : `tid` lu avant vérification uniquement pour choisir l'émetteur ; tenant autorisé, signature, émetteur propre au tenant, audience et nonce vérifiés ; rôle admin réservé au tenant principal.
- Client Graph : jeton envoyé uniquement à `https://graph.microsoft.com/v1.0/` (pagination comprise) ; URL de site validée et encodée.
- Emails : HTML échappé ; liens vers SharePoint filtrés (`https://*.sharepoint.com`) ; aucun `v-html`.
- Schémas Zod stricts (pas d'affectation de masse), requêtes Drizzle paramétrées, pas de secret dans les logs.

### Constats et corrections

| # | Gravité | Constat | Correction |
|---|---|---|---|
| 1 | Moyenne | La collecte pouvait ajouter des lignes après l'ouverture (ou la clôture) de la session | Ouverture refusée pendant une collecte ; chaque ajout se fait en transaction avec la session verrouillée (`FOR SHARE`) et vérifie le statut brouillon |
| 2 | Moyenne/faible | Une collecte déclarée interrompue pouvait continuer en parallèle d'une relance (numéros de ligne en double) | Ajout conditionné à l'exécution encore « en cours » (`FOR UPDATE`) ; index unique `(session_id, row_number)` ; attente Graph plafonnée à 60 s, délai d'interruption porté à 10 min |
| 3 | Faible | Mémoire non bornée sur une très grosse bibliothèque | Forme réduite des éléments en mémoire ; plafond de 400 000 éléments par bibliothèque (erreur signalée) |
| 4 | Faible | « Mauvaise attribution » possible après un retrait déjà effectué | Refus 409 |
| 5 | Faible | Autorité OIDC du cookie non contrôlée | Restreinte à `organizations` ou un GUID |
| 6 | Faible | Un tenant désactivé ne coupait pas les sessions en cours | `requireUser` vérifie que le tenant du compte est autorisé |
| 7 | Faible | Envoi d'emails potentiellement très long | 100 destinataires maximum par envoi |
| 8 | Faible | `UPDATE` inutile sur `notifications` | Droits réduits à `SELECT, INSERT` |

### Risques acceptés / à surveiller

- La collecte n'interroge que la racine des bibliothèques et les éléments marqués « partagés » (facette `shared`) : à valider sur un site réel en comparant avec le rapport de partage SharePoint.
- Les membres externes d'un site via ses groupes SharePoint / Microsoft 365 ne sont pas encore couverts.
- `npm audit --omit=dev` : 13 vulnérabilités (2 faibles, 11 modérées), toutes dans l'outillage de build (archiver, minimatch…) ; le correctif proposé rétrograde Nuxt (4.1.3) et est refusé. Aucune vulnérabilité haute.

## TNR

- `npm run typecheck` : OK
- `npm run test` : 69/69
- `npm run test:e2e` : 23/23

## Actions côté administrateurs (hors code)

1. App registration ControleIT : passer en **multi-locataire** ; ajouter `Sites.Read.All` (Application) et donner le consentement administrateur Fimavi.
2. Chaque filiale : ouvrir le lien de consentement (Paramètres) avec un administrateur de la filiale.
3. Exchange : RBAC for Applications limitant `Application Mail.Send` à helpdesk@fimavi.com ; **ne pas** accorder `Mail.Send` dans Entra.
