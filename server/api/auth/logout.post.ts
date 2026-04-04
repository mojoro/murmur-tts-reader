import { AUTH_COOKIE_NAME } from '../../utils/orchestrator'

export default defineEventHandler(async (event) => {
  deleteCookie(event, AUTH_COOKIE_NAME, { path: '/' })
  setResponseStatus(event, 204)
  return null
})
