import { orchestratorFetch, AUTH_COOKIE_NAME, authCookieOptions } from '../../utils/orchestrator'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  try {
    const data = await orchestratorFetch<{ user: Record<string, unknown>; token: string }>(
      event,
      '/auth/register',
      { method: 'POST', body },
    )

    setCookie(event, AUTH_COOKIE_NAME, data.token, authCookieOptions())
    setResponseStatus(event, 201)
    return data.user
  } catch (error: any) {
    throw createError({
      statusCode: error.statusCode || error.status || 500,
      statusMessage: error.data?.detail || 'Registration failed',
    })
  }
})
