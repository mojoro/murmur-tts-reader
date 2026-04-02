import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './shared/schema.ts',
  out: './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './pocket-tts.db',
  },
})
