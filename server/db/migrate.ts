import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index'
import { join } from 'path'

export function runMigrations() {
  migrate(db, { migrationsFolder: join(process.cwd(), 'server/db/migrations') })
}
