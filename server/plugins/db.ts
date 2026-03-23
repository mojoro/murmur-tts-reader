import { runMigrations } from '../db/migrate'

export default defineNitroPlugin(() => {
  runMigrations()
})
