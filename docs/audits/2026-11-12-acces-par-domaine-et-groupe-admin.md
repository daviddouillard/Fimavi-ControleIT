# Audit — Accès limité aux domaines internes, administrateurs par groupe Entra (2026-11-12)

## Périmètre

- **Connexion** : un compte non administrateur n'est accepté que si son email ou son identifiant de connexion (`email`, `preferred_username` du jeton d'identité vérifié) appartient à un domaine interne du groupe (Paramètres), ou à l'un de ses sous-domaines.
  - Cette règle s'ajoute à la règle existante sur les tenants (tenant principal ou tenant filiale raccordé et actif).
  - En cas de refus, l'écran de connexion affiche un message explicite (`/login?error=domain`).
- **Administrateurs** : ils sont toujours acceptés, même avec un compte `onmicrosoft.com`, afin de pouvoir paramétrer les domaines. Seuls les comptes du tenant principal ayant le rôle d'application admin le sont.
- **Gestion des administrateurs** : par le groupe Entra `GCP-FIMAVI-ControleIT-Admin`, affecté au rôle d'application. Configuration Entra uniquement, sans changement de code.

## Revue de sécurité

- **Contrôle d'accès** :
  - le contrôle est fait côté serveur, à la connexion, sur les revendications d'un jeton dont la signature, l'émetteur, le nonce et le PKCE sont vérifiés ;
  - le domaine est comparé exactement ou en suffixe `.domaine` : `notfimavi.com` et `fimavi.com.evil.io` sont refusés (tests) ;
  - liste vide : seuls les administrateurs entrent (fermé par défaut).
- **Effet d'un changement** : un retrait de domaine prend effet à la connexion suivante (session de 1 heure au plus). Une désactivation de compte prend effet immédiatement, comme avant.
- **Journalisation** : un refus est journalisé sans donnée personnelle ni jeton (« Domaine du compte non autorisé »).
- **Groupe d'administration** : l'affectation d'un groupe à un rôle d'application exige Entra ID P1. Les comptes d'administration hors du groupe doivent être retirés de l'affectation directe.

Aucun constat ouvert.

## TNR

- `npm run typecheck` : OK
- `npm run test` : 85/85. Nouveaux tests `tests/unit/access.test.ts` : domaine et sous-domaine acceptés, domaines ressemblants refusés, liste vide, administrateur.
- `npm run test:e2e` : 24/24
