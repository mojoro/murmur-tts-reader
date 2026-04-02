import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const reads = sqliteTable('reads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  type: text('type').notNull(), // 'text' | 'url' | 'file'
  sourceUrl: text('source_url'),
  fileName: text('file_name'),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  progressSegment: integer('progress_segment').default(0),
  progressWord: integer('progress_word').default(0),
})

export const audioSegments = sqliteTable('audio_segments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  readId: integer('read_id').notNull().references(() => reads.id, { onDelete: 'cascade' }),
  segmentIndex: integer('segment_index').notNull(),
  text: text('text').notNull(),
  audioPath: text('audio_path'),
  wordTimingsJson: text('word_timings_json'), // JSON string: [{word, start, end}]
  generatedAt: integer('generated_at', { mode: 'timestamp' }),
})

export const voices = sqliteTable('voices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type').notNull(), // 'builtin' | 'cloned'
  wavPath: text('wav_path'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const bookmarks = sqliteTable('bookmarks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  readId: integer('read_id').notNull().references(() => reads.id, { onDelete: 'cascade' }),
  segmentIndex: integer('segment_index').notNull(),
  wordOffset: integer('word_offset').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
