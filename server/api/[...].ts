export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const userId = event.context.userId as number

  // event.path includes query params, e.g. /api/reads?q=hello
  // Strip /api to get orchestrator path: /reads?q=hello
  const targetPath = event.path!.replace(/^\/api/, '')
  const target = `${config.orchestratorUrl}${targetPath}`

  return proxyRequest(event, target, {
    headers: { 'X-User-Id': String(userId) },
  })
})
