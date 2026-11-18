# Audit — Modèle « Services Gandi » : certificats SSL et hébergements web (2026-11-18)

## Périmètre

Extension du modèle « Noms de domaine (Gandi) », renommé « Services Gandi ». La clé `gandi-domains` ne change pas.

- **Nouvelles lectures** (`server/utils/gandi.ts`), toutes en `GET` paginé, 100 par page :
  - `GET /v5/certificate/issued-certs` : certificats SSL. Les certificats expirés, révoqués ou remplacés sont ignorés.
  - `GET /v5/simplehosting/instances` : hébergements web. Ceux en cours de suppression sont ignorés.
- **Une ligne par service** (`server/controls/gandi-domains/`), avec :
  - le type de service ;
  - le nom ;
  - l'échéance (`dates.ends_at` pour un certificat, `expire_at` pour un hébergement) ;
  - l'offre ;
  - les autres noms couverts par un certificat ;
  - le domaine principal d'un hébergement ;
  - le renouvellement automatique d'un hébergement.

  Les lignes sont triées par échéance, toutes sources confondues.
- **Un type refusé par le jeton** est signalé dans le compte rendu de collecte, sans bloquer les autres types.
- **« Tester Gandi »** renvoie le nombre de domaines, de certificats et d'hébergements lisibles, ou le type refusé.
- **Réponses** : « Renouveler » (au lieu de « Renouveler le domaine ») ou « Ne plus renouveler ».
- **Textes** : email, paramètres et création de session couvrent maintenant les trois types de service.
- **Non couvert** : GandiCloud (VPS). Il passe par l'API OpenStack, avec d'autres identifiants que le jeton Gandi.

## Revue de sécurité

- **Moindre privilège** :
  - l'application ne fait que des lectures et n'appelle aucune route de renouvellement ;
  - Gandi ne propose pas de droit en lecture seule pour les domaines et les hébergements : le jeton porte « Voir et renouveler ». Ce risque est accepté : le jeton reste dans Secret Manager et n'est lu que par `controleit-run` ;
  - le droit « Voir les ressources Cloud » n'est pas utilisé. Il est recommandé de le retirer du jeton.
- **SSRF et fuite du jeton** :
  - les URL sont fixes et construites par l'application, sans lien de pagination repris de la réponse ;
  - le préfixe `https://api.gandi.net/v5/` est vérifié avant chaque appel.
- **Erreurs** : seul le statut HTTP est conservé, jamais le corps de la réponse ni le jeton. La route de test ne renvoie que des nombres et des messages fixes.
- **Autorisation** : la route de test est inchangée et réservée aux admins (`requireAdmin`).
- **Validation** : chaque élément est validé par Zod (schémas `loose`, champs utiles typés).
- **XSS** : les nouvelles données sont affichées par interpolation Vue, sans `v-html`.

Aucun constat ouvert.

## TNR

- `npm run typecheck` : OK.
- `npm run test` : 123/123. Nouveaux tests :
  - lignes « certificat » et « hébergement » ;
  - routes Gandi lues ;
  - certificat expiré ignoré ;
  - type refusé signalé sans bloquer les autres.
- `npm run test:e2e` : 26/26.
- `npm run audit:deps` : aucun avis bloquant. L'exception `picomatch` court jusqu'au 2026-12-31.
