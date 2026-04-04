import type { AudioSegment } from '~/types/api'

const RATE_STORAGE_KEY = 'pocket-tts-playback-rate'

function loadRate(): number {
  if (!import.meta.client) return 1.0
  const saved = localStorage.getItem(RATE_STORAGE_KEY)
  return saved ? parseFloat(saved) : 1.0
}

// Module-level state is safe: audio playback is purely client-side.
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const playbackRate = ref(loadRate())
const currentSegmentIndex = ref(0)
const segments = ref<AudioSegment[]>([])

let audio: HTMLAudioElement | null = null

function ensureAudio(): HTMLAudioElement {
  if (!audio && import.meta.client) {
    audio = new Audio()
    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio!.currentTime
    })
    audio.addEventListener('durationchange', () => {
      duration.value = audio!.duration
    })
    audio.addEventListener('ended', () => {
      isPlaying.value = false
      const nextIndex = currentSegmentIndex.value + 1
      if (nextIndex < segments.value.length && segments.value[nextIndex].audio_generated) {
        playSegment(nextIndex)
      }
    })
    audio.addEventListener('play', () => {
      isPlaying.value = true
    })
    audio.addEventListener('pause', () => {
      isPlaying.value = false
    })
  }
  return audio!
}

async function playSegment(index: number) {
  if (!import.meta.client) return
  const segment = segments.value[index]
  if (!segment?.audio_generated) return

  const url = `/api/audio/${segment.read_id}/${segment.segment_index}`
  currentSegmentIndex.value = index

  const el = ensureAudio()
  el.src = url
  el.playbackRate = playbackRate.value
  await el.play()
}

export function useAudioPlayer() {
  function setSegments(segs: AudioSegment[], initialSegment?: number) {
    segments.value = segs
    if (initialSegment !== undefined && initialSegment > 0 && segs.length) {
      currentSegmentIndex.value = initialSegment
    }
  }

  function play() {
    if (!import.meta.client) return
    const el = ensureAudio()
    if (el.src) el.play()
  }

  function pause() {
    if (!import.meta.client) return
    ensureAudio().pause()
  }

  function togglePlayPause() {
    if (isPlaying.value) pause()
    else play()
  }

  function seek(time: number) {
    if (!import.meta.client) return
    ensureAudio().currentTime = time
  }

  function setRate(rate: number) {
    playbackRate.value = rate
    if (audio) audio.playbackRate = rate
    if (import.meta.client) {
      localStorage.setItem(RATE_STORAGE_KEY, String(rate))
    }
  }

  function skipPrev() {
    const prevIndex = currentSegmentIndex.value - 1
    if (prevIndex >= 0) playSegment(prevIndex)
  }

  function skipNext() {
    const nextIndex = currentSegmentIndex.value + 1
    if (nextIndex < segments.value.length && segments.value[nextIndex].audio_generated) {
      playSegment(nextIndex)
    }
  }

  function stop() {
    if (!import.meta.client) return
    if (audio) {
      audio.pause()
      audio.src = ''
    }
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
  }

  return {
    isPlaying: readonly(isPlaying),
    currentTime: readonly(currentTime),
    duration: readonly(duration),
    playbackRate: readonly(playbackRate),
    currentSegmentIndex: readonly(currentSegmentIndex),
    segments: readonly(segments),
    setSegments,
    playSegment,
    play,
    pause,
    togglePlayPause,
    seek,
    setRate,
    skipPrev,
    skipNext,
    stop,
  }
}
