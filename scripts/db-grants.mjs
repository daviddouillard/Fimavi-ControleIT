// Crée (ou met à jour) le rôle applicatif restreint et ses droits. Exécuté par le pipeline après les migrations,
// avec le rôle propriétaire. Variables : DATABASE_MIGRATION_URL, APP_DB_PASSWORD.
import pg from 'pg'

const ownerUrl = process.env.DATABASE_MIGRATION_URL
const appPassword = process.env.APP_DB_PASSWORD
if (!ownerUrl || !appPassword) {
  console.error('DATABASE_MIGRATION_URL et APP_DB_PASSWORD sont requis')
  process.exit(1)
}

const client = new pg.Client({ connectionString: ownerUrl })
await client.connect()
try {
  const { rowCount } = await client.query(`select 1 from pg_roles where rolname = 'controleit_app'`)
  const verb = rowCount ? 'ALTER' : 'CREATE'
  await client.query(`${verb} ROLE controleit_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${client.escapeLiteral(appPassword)}`)

  await client.query(`
    GRANT CONNECT ON DATABASE ${client.escapeIdentifier(client.database)} TO controleit_app;
    GRANT USAGE ON SCHEMA public TO controleit_app;
    GRANT SELECT, INSERT, UPDATE ON users, control_sessions, check_items, remediations TO controleit_app;
    REVOKE DELETE, TRUNCATE ON users, control_sessions, check_items, remediations FROM controleit_app;
    GRANT SELECT, INSERT ON audit_log TO controleit_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM controleit_app;
    GRANT USAGE ON SEQUENCE audit_log_id_seq TO controleit_app;
  `)
  console.log(`Rôle controleit_app : ${verb === 'CREATE' ? 'créé' : 'mis à jour'}, droits appliqués`)
} finally {
  await client.end()
}
