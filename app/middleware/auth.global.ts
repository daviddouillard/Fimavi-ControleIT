// Garde de navigation (confort UX uniquement) : l'autorisation réelle est vérifiée côté serveur sur chaque route API.
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()

  if (to.path === '/login') {
    return loggedIn.value ? navigateTo('/') : undefined
  }
  if (!loggedIn.value) return navigateTo('/login')
  if (to.path.startsWith('/admin') && !user.value?.isAdmin) return navigateTo('/')
})
