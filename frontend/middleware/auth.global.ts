export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, initialized, fetchUser } = useAuth()

  if (!initialized.value) {
    await fetchUser()
  }

  const publicRoutes = ['/login', '/register']

  if (!loggedIn.value && !publicRoutes.includes(to.path)) {
    return navigateTo('/login')
  }

  if (loggedIn.value && publicRoutes.includes(to.path)) {
    return navigateTo('/')
  }
})
