# Base de données : rôles et droits

Deux rôles PostgreSQL distincts. Le rôle applicatif ne possède pas les tables : il ne peut ni désactiver le trigger du journal d'audit, ni modifier ou supprimer ses lignes.

| Rôle | Utilisé par | Variable |
|---|---|---|
| `controleit_owner` | `npm run db:migrate` uniquement | `DATABASE_MIGRATION_URL` |
| `controleit_app` | l'application (Cloud Run) | `NUXT_DATABASE_URL` |

Les mots de passe sont stockés dans GCP Secret Manager, jamais dans le dépôt.

## Script d'initialisation (à exécuter une fois par un administrateur Cloud SQL)

```sql
CREATE ROLE controleit_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE controleit_app   LOGIN PASSWORD :'app_password';

GRANT CONNECT ON DATABASE controleit TO controleit_owner, controleit_app;
GRANT USAGE, CREATE ON SCHEMA public TO controleit_owner;
GRANT USAGE ON SCHEMA public TO controleit_app;
```

## Droits du rôle applicatif (après chaque migration créant des tables)

```sql
-- Tables métier : lecture/écriture
GRANT SELECT, INSERT, UPDATE ON users, control_sessions, check_items, remediations TO controleit_app;
-- Journal d'audit : ajout et lecture uniquement
GRANT SELECT, INSERT ON audit_log TO controleit_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM controleit_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO controleit_app;
```

Aucune suppression physique n'est accordée au rôle applicatif : l'historique est conservé en totalité.

## Recommandation complémentaire

Exporter aussi le journal d'audit vers Cloud Logging, ou vers un bucket avec rétention verrouillée, pour en avoir une copie hors de la base.
