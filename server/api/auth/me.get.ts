import { orchestratorFetch } from '../../utils/orchestrator'

export default defineEventHandler(async (event) => {
  const userId = event.context.userId as number

  try {
    return await orchestratorFetch(event, '/auth/me', { userId })
  } catch (error: any) {
    throw createError({
      statusCode: error.statusCode || error.status || 500,
      statusMessage: error.data?.detail || 'Failed to fetch user',
    })
  }
})
