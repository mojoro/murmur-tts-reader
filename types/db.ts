import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { reads, audioSegments, voices, bookmarks } from '~/shared/schema'

export type Read = InferSelectModel<typeof reads>
export type NewRead = InferInsertModel<typeof reads>

export type AudioSegment = InferSelectModel<typeof audioSegments>
export type NewAudioSegment = InferInsertModel<typeof audioSegments>

export type Voice = InferSelectModel<typeof voices>
export type NewVoice = InferInsertModel<typeof voices>

export type Bookmark = InferSelectModel<typeof bookmarks>
export type NewBookmark = InferInsertModel<typeof bookmarks>
