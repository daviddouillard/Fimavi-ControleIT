/** Identifiants fixes des données E2E, partagés entre le serveur de base et les tests. */
export const E2E_DB_PORT = 5499

export const IDS = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  validator: '00000000-0000-4000-8000-0000000000b1',
  otherValidator: '00000000-0000-4000-8000-0000000000b2',
  session: '00000000-0000-4000-8000-0000000000c1',
  items: [1, 2, 3, 4].map(n => `00000000-0000-4000-8000-0000000000d${n}`)
}

export const USERS = {
  admin: { id: IDS.admin, entraId: 'e2e-admin', name: 'Admin IT', email: 'admin@fimavi.test', isAdmin: true },
  validator: { id: IDS.validator, entraId: 'e2e-validator', name: 'Valérie Valideuse', email: 'valerie@fimavi.test', isAdmin: false },
  otherValidator: { id: IDS.otherValidator, entraId: 'e2e-other', name: 'Marc Manager', email: 'marc@fimavi.test', isAdmin: false }
}
