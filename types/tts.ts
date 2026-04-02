export interface HealthResponse {
  status: string
  model_loaded: boolean
  backend: string
}

export interface VoicesResponse {
  builtin: string[]
  custom: string[]
}

export interface GenerateRequest {
  text: string
  voice: string
  language?: string
}

export interface CloneVoiceResponse {
  voice: string
  message: string
}

export interface WordTiming {
  word: string
  start: number
  end: number
}

export interface AlignmentResponse {
  words: WordTiming[]
}

// SSE event types for streaming TTS generation
export interface SegmentStartEvent {
  type: 'segment:start'
  segmentIndex: number
  text: string
}

export interface SegmentAudioEvent {
  type: 'segment:audio'
  segmentIndex: number
  audioPath: string
}

export interface SegmentAlignedEvent {
  type: 'segment:aligned'
  segmentIndex: number
  words: WordTiming[]
}

export interface SegmentErrorEvent {
  type: 'segment:error'
  segmentIndex: number
  error: string
}

export interface GenerationDoneEvent {
  type: 'generation:done'
  generated: number
}

export type GenerationEvent =
  | SegmentStartEvent
  | SegmentAudioEvent
  | SegmentAlignedEvent
  | SegmentErrorEvent
  | GenerationDoneEvent
