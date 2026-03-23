// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  compatibilityDate: '2025-03-23',
  devServer: {
    port: 4000
  },
  colorMode: {
    preference: 'dark'
  }
})
