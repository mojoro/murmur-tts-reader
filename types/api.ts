// types/api.ts

// ── Auth ──

export interface User {
  id: number
  email: string
  display_name: string | null
  created_at: string
}

// ── Reads ──

export interface ReadSummary {
  id: number
  title: string
  type: 'text' | 'url' | 'file'
  source_url: string | null
  file_name: string | null
  progress_segment: number
  progress_word: number
  segment_count: number
  created_at: string
  updated_at: string
  voice: string | null
  engine: string | null
  generated_at: string | null
}

export interface AudioSegment {
  id: number
  read_id: number
  segment_index: number
  text: string
  audio_generated: boolean
  word_timings_json: string | null
  generated_at: string | null
}

export interface ReadDetail {
  id: number
  title: string
  type: 'text' | 'url' | 'file'
  source_url: string | null
  file_name: string | null
  content: string
  progress_segment: number
  progress_word: number
  created_at: string
  updated_at: string
  voice: string | null
  engine: string | null
  generated_at: string | null
  segments: AudioSegment[]
}

// ── Voices ──

export interface Voice {
  id: number
  user_id: number | null
  name: string
  type: 'builtin' | 'cloned'
  created_at: string
}

// ── Bookmarks ──

export interface Bookmark {
  id: number
  read_id: number
  segment_index: number
  word_offset: number
  note: string | null
  created_at: string
}

// ── Jobs / Queue ──

export type JobStatus = 'pending' | 'running' | 'waiting_for_backend' | 'done' | 'failed' | 'cancelled'

export interface Job {
  id: number
  user_id: number
  read_id: number
  voice: string
  engine: string
  language: string | null
  status: JobStatus
  progress: number
  total: number
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

// ── Backends / Engines ──

export type EngineStatus = 'available' | 'installing' | 'installed' | 'running' | 'stopped' | 'unavailable'

export interface Backend {
  name: string
  display_name: string
  description: string
  size: string
  status: EngineStatus
  gpu: boolean
  builtin_voices: boolean
}

// ── Health ──

export interface HealthResponse {
  status: string
  db: string
  active_engine: string | null
  alignment: string | null
}

// ── Word timing (used by WordHighlighter) ──

export interface WordTiming {
  word: string
  start: number
  end: number
}

// ── Offline ──

export interface OfflineMutation {
  id: string
  url: string
  method: 'PATCH' | 'POST' | 'DELETE'
  body?: unknown
  timestamp: number
}
