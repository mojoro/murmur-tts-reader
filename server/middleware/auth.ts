import { AUTH_COOKIE_NAME } from '../utils/orchestrator'
import { verifyToken } from '../utils/jwt'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Only protect /api/* routes — skip pages, _nuxt assets, etc.
  if (!path.startsWith('/api/')) {
    return
  }

  // Public API routes
  if (
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/register') ||
    path.startsWith('/api/auth/logout') ||
    path === '/api/health'
  ) {
    return
  }

  const token = getCookie(event, AUTH_COOKIE_NAME)
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  try {
    const config = useRuntimeConfig(event)
    const userId = await verifyToken(token, config.jwtSecret)
    event.context.userId = userId
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
  }
})
