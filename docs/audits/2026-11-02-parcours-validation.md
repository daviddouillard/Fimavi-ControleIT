# Audit de sécurité et TNR — Parcours de validation

- **Date** : 2026-11-02
- **Périmètre** : réponse du valideur (Oui/Non, commentaire obligatoire si Non, changement d'avis), assignation multiple, clôture de lignes sans validation, ouverture et clôture de session, pot commun IT (« Fait »), recherche dans l'annuaire, écrans valideur et admin, outillage E2E connecté.
- **Méthode** : revue de code indépendante sur le diff, `npm audit`, TNR complets.

## Constats et traitement

| # | Sévérité | Constat | Statut |
|---|---|---|---|
| 1 | Moyenne | Un « Non → Oui » simultané à un « Fait » de l'IT pouvait repasser une action effectuée en « annulée » : le retrait disparaissait de l'historique. Un « Oui » après un retrait effectué n'était pas tracé. | **Corrigé** : verrou sur l'action de retrait, mises à jour conditionnées au statut attendu, un retrait effectué n'est jamais annulé et le cas est tracé (`already_removed`). |
| 2 | Faible | Le statut de session était lu sans verrou : une modification pouvait passer juste après une clôture. | **Corrigé** : verrou partagé sur la session (`FOR SHARE`) et ordre de verrouillage unique (session → ligne → action). |
| 3 | Faible | État « avant » incomplet dans l'audit (ancien valideur, ligne liée à l'action de retrait). | **Corrigé** : ancien valideur par ligne, `checkItemId` dans `remediation.done`. |
| 4 | Faible | Entrées d'audit vides quand aucune ligne n'était modifiée. | **Corrigé** : rien n'est journalisé dans ce cas. |

Points vérifiés sans constat :
- **Autorisation** : chaque route exige un utilisateur ou un admin. Un valideur reçoit 404 pour une ligne qui ne lui est pas assignée, et 409 hors session ouverte.
- **Requêtes** : les mises à jour sont filtrées par session et par état ; toutes les entrées passent par Zod ; les jokers LIKE sont neutralisés.
- **Affichage et erreurs** : aucun `v-html`, et les messages d'erreur ne contiennent aucun détail technique.
- **Outillage E2E** : il n'introduit aucune porte dérobée dans l'application. Le cookie est scellé par le test avec un secret aléatoire, et la base de test n'écoute que sur 127.0.0.1.

## Dépendances

`npm audit --omit=dev` : 0 critique, 0 élevée. Les 12 modérées et 2 faibles sont inchangées et concernent toutes l'outillage de build (voir l'audit du squelette).

## TNR

| Suite | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm run test` (unitaires + intégration PGlite) | 34/34 |
| `npm run test:e2e` (build de production + base PGlite en TCP, utilisateurs connectés) | 17/17 |

Limites :
- Le test de simultanéité tourne sur PGlite, qui n'a qu'une connexion. Il vérifie le résultat final dans les deux ordres d'exécution, mais pas les verrous, qui reposent sur le comportement standard de PostgreSQL.
- Non couvert : la connexion Entra réelle et Cloud SQL, en attente de l'infrastructure.
