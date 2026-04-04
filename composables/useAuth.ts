import type { User } from '~/types/api'

export function useAuth() {
  const user = useState<User | null>('auth-user', () => null)
  const initialized = useState('auth-initialized', () => false)
  const loggedIn = computed(() => !!user.value)

  async function fetchUser() {
    try {
      user.value = await $fetch<User>('/api/auth/me')
    } catch {
      user.value = null
    }
    initialized.value = true
  }

  async function login(email: string, password: string) {
    user.value = await $fetch<User>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    initialized.value = true
  }

  async function register(email: string, password: string, displayName?: string) {
    user.value = await $fetch<User>('/api/auth/register', {
      method: 'POST',
      body: { email, password, display_name: displayName },
    })
    initialized.value = true
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
    initialized.value = false
    await navigateTo('/login')
  }

  return {
    user: readonly(user),
    loggedIn,
    initialized: readonly(initialized),
    fetchUser,
    login,
    register,
    logout,
  }
}
