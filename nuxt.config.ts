// https://nuxt.com/docs/api/configuration/nuxt-config
// Aucun secret ici : toutes les valeurs sensibles sont surchargées par les variables NUXT_* (voir .env.example).
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', 'nuxt-auth-utils', 'nuxt-security'],

  css: ['~/assets/css/main.css'],

  typescript: {
    strict: true
  },

  runtimeConfig: {
    // Session scellée par nuxt-auth-utils à partir de NUXT_APP_SECRET (≥ 32 caractères).
    session: {
      maxAge: 60 * 60
    },
    oauth: {
      // NUXT_OAUTH_MICROSOFT_CLIENT_ID / _CLIENT_SECRET / _TENANT / _REDIRECT_URL
      microsoft: {
        clientId: '',
        clientSecret: '',
        tenant: '',
        redirectURL: ''
      }
    },
    // NUXT_DATABASE_URL
    databaseUrl: '',
    // NUXT_ADMIN_ROLE : valeur de l'app role Entra donnant le droit administrateur (nomenclature interne).
    adminRole: '',
    // NUXT_MAIL_SENDER : boîte d'envoi des emails aux valideurs (ex. helpdesk@…)
    mailSender: '',
    // NUXT_COLLECTION_JOB : Job Cloud Run des collectes (projects/<projet>/locations/<région>/jobs/<job>) ; vide = collecte dans le processus.
    collectionJob: '',
    // NUXT_COLLECTION_RUN_ID : posé uniquement par le lancement du Job (le conteneur exécute cette collecte puis s'arrête).
    collectionRunId: '',
    public: {}
  },

  security: {
    // On garde les logs serveur (Cloud Logging) ; ils ne doivent jamais contenir de secret ni de jeton.
    removeLoggers: false,
    headers: {
      crossOriginEmbedderPolicy: process.env.NODE_ENV === 'development' ? 'unsafe-none' : 'require-corp',
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'connect-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'frame-ancestors': ["'none'"]
      },
      xFrameOptions: 'DENY'
    },
    requestSizeLimiter: {
      maxRequestSizeInBytes: 2_000_000,
      maxUploadFileRequestInBytes: 8_000_000
    }
  }
})
