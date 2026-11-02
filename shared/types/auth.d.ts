declare module '#auth-utils' {
  interface User {
    /** Identifiant interne (table users) */
    id: string
    /** Object ID Entra (claim oid) */
    entraId: string
    name: string
    email: string | null
    isAdmin: boolean
  }

  interface UserSession {
    loggedInAt: string
  }
}

export {}
