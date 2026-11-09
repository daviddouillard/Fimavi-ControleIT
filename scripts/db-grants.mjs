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
  const password = client.escapeLiteral(appPassword)
  // Sur Cloud SQL, le propriétaire n'est pas superutilisateur : il peut créer un rôle restreint, mais ne peut pas
  // modifier ensuite l'attribut SUPERUSER. La mise à jour ne touche donc que le mot de passe.
  await client.query(verb === 'CREATE'
    ? `CREATE ROLE controleit_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${password}`
    : `ALTER ROLE controleit_app WITH LOGIN PASSWORD ${password}`)

  await client.query(`
    GRANT CONNECT ON DATABASE ${client.escapeIdentifier(client.database)} TO controleit_app;
    GRANT USAGE ON SCHEMA public TO controleit_app;
    GRANT SELECT, INSERT, UPDATE ON users, control_sessions, check_items, remediations TO controleit_app;
    REVOKE DELETE, TRUNCATE ON users, control_sessions, check_items, remediations FROM controleit_app;
    GRANT SELECT, INSERT ON audit_log TO controleit_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM controleit_app;
    GRANT USAGE ON SEQUENCE audit_log_id_seq TO controleit_app;
    GRANT SELECT, INSERT, UPDATE ON collection_runs TO controleit_app;
    REVOKE DELETE, TRUNCATE ON collection_runs FROM controleit_app;
    -- Emails envoyés : historique en ajout seul.
    GRANT SELECT, INSERT ON notifications TO controleit_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON notifications FROM controleit_app;
    -- Paramètres : la liste des domaines est remplacée en bloc, un site ou un tenant sans site peut être retiré.
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_connections, sharepoint_sites, internal_domains TO controleit_app;
    REVOKE TRUNCATE ON tenant_connections, sharepoint_sites, internal_domains FROM controleit_app;
  `)
  console.log(`Rôle controleit_app : ${verb === 'CREATE' ? 'créé' : 'mis à jour'}, droits appliqués`)
} finally {
  await client.end()
}
