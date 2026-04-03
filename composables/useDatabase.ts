import type { Database } from 'sql.js'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import * as schema from '~/shared/schema'

const DB_NAME = 'pocket-tts'
const DB_STORE = 'database'
const DB_KEY = 'sqlite'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS \`reads\` (
  \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  \`title\` text NOT NULL,
  \`type\` text NOT NULL,
  \`source_url\` text,
  \`file_name\` text,
  \`content\` text NOT NULL,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  \`progress_segment\` integer DEFAULT 0,
  \`progress_word\` integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS \`audio_segments\` (
  \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  \`read_id\` integer NOT NULL,
  \`segment_index\` integer NOT NULL,
  \`text\` text NOT NULL,
  \`audio_path\` text,
  \`word_timings_json\` text,
  \`generated_at\` integer,
  FOREIGN KEY (\`read_id\`) REFERENCES \`reads\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS \`voices\` (
  \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  \`name\` text NOT NULL,
  \`type\` text NOT NULL,
  \`wav_path\` text,
  \`created_at\` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS \`voices_name_unique\` ON \`voices\` (\`name\`);

CREATE TABLE IF NOT EXISTS \`bookmarks\` (
  \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  \`read_id\` integer NOT NULL,
  \`segment_index\` integer NOT NULL,
  \`word_offset\` integer NOT NULL,
  \`note\` text,
  \`created_at\` integer NOT NULL,
  FOREIGN KEY (\`read_id\`) REFERENCES \`reads\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

PRAGMA foreign_keys = ON;
`

let dbInstance: SQLJsDatabase<typeof schema> | null = null
let sqliteDb: Database | null = null
let initPromise: Promise<SQLJsDatabase<typeof schema>> | null = null

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadFromIDB(): Promise<Uint8Array | null> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readonly')
    const store = tx.objectStore(DB_STORE)
    const request = store.get(DB_KEY)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => idb.close()
  })
}

async function saveToIDB(data: Uint8Array): Promise<void> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite')
    const store = tx.objectStore(DB_STORE)
    store.put(data, DB_KEY)
    tx.oncomplete = () => {
      idb.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

async function initDatabase(): Promise<SQLJsDatabase<typeof schema>> {
  const initSqlJs = (await import('sql.js')).default
  const { drizzle } = await import('drizzle-orm/sql-js')

  const SQL = await initSqlJs({
    locateFile: () => '/sql-wasm.wasm',
  })

  const existing = await loadFromIDB()
  sqliteDb = existing ? new SQL.Database(existing) : new SQL.Database()

  // Apply schema (CREATE IF NOT EXISTS is idempotent)
  sqliteDb.run(SCHEMA_SQL)

  // Persist after schema init
  await persist()

  return drizzle(sqliteDb, { schema })
}

async function persist(): Promise<void> {
  if (!sqliteDb) return
  const data = sqliteDb.export()
  await saveToIDB(data)
}

export function useDatabase() {
  async function getDb(): Promise<SQLJsDatabase<typeof schema>> {
    if (dbInstance) return dbInstance

    if (!initPromise) {
      initPromise = initDatabase().then((db) => {
        dbInstance = db
        return db
      })
    }

    return initPromise
  }

  return {
    getDb,
    persist,
  }
}
