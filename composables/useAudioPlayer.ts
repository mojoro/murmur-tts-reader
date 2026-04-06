import type { AudioSegment } from '~/types/api'

const RATE_STORAGE_KEY = 'murmur-playback-rate'

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
const currentReadId = ref<number | null>(null)
const currentReadTitle = ref('')
const segmentDurations = reactive(new Map<number, number>())

let audio: HTMLAudioElement | null = null

function ensureAudio(): HTMLAudioElement {
  if (!audio && import.meta.client) {
    audio = new Audio()
    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio!.currentTime
    })
    audio.addEventListener('durationchange', () => {
      duration.value = audio!.duration
      if (audio!.duration && isFinite(audio!.duration)) {
        segmentDurations.set(currentSegmentIndex.value, audio!.duration)
      }
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
    // Re-apply playback rate when audio starts — some browsers reset it on src change
    audio.addEventListener('playing', () => {
      if (audio && audio.playbackRate !== playbackRate.value) {
        audio.playbackRate = playbackRate.value
      }
    })
  }
  return audio!
}

const WORDS_PER_MINUTE = 150

function estimateSegmentDuration(seg: AudioSegment): number {
  const known = segmentDurations.get(seg.segment_index)
  if (known) return known
  const wordCount = seg.text.split(/\s+/).length
  return (wordCount / WORDS_PER_MINUTE) * 60
}

async function playSegment(index: number, startOffset?: number) {
  if (!import.meta.client) return
  const segment = segments.value[index]
  if (!segment?.audio_generated) return

  const url = `/api/audio/${segment.read_id}/${segment.segment_index}`
  currentSegmentIndex.value = index

  const el = ensureAudio()
  el.src = url
  el.defaultPlaybackRate = playbackRate.value
  el.playbackRate = playbackRate.value

  // If seeking into the segment, wait for metadata so the seek sticks before play
  if (startOffset && startOffset > 0) {
    await new Promise<void>((resolve) => {
      const handler = () => {
        el.removeEventListener('loadedmetadata', handler)
        el.currentTime = startOffset
        resolve()
      }
      el.addEventListener('loadedmetadata', handler)
    })
  }

  await el.play()
}

export function useAudioPlayer() {
  function setSegments(segs: AudioSegment[], opts?: { initialSegment?: number; readId?: number; readTitle?: string }) {
    if (opts?.readId !== undefined && opts.readId !== currentReadId.value) {
      segmentDurations.clear()
    }
    segments.value = segs
    if (opts?.readId !== undefined) currentReadId.value = opts.readId
    if (opts?.readTitle !== undefined) currentReadTitle.value = opts.readTitle
    if (opts?.initialSegment !== undefined && opts.initialSegment > 0 && segs.length) {
      currentSegmentIndex.value = opts.initialSegment
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
    if (audio) {
      audio.defaultPlaybackRate = rate
      audio.playbackRate = rate
    }
    if (import.meta.client) {
      localStorage.setItem(RATE_STORAGE_KEY, String(rate))
    }
  }

  function seekToGlobal(globalTime: number) {
    if (!import.meta.client || segments.value.length === 0) return
    let accumulated = 0
    let targetIndex = segments.value.length - 1
    let offset = 0
    for (let i = 0; i < segments.value.length; i++) {
      const segDur = estimateSegmentDuration(segments.value[i])
      if (globalTime <= accumulated + segDur) {
        targetIndex = i
        offset = globalTime - accumulated
        break
      }
      accumulated += segDur
    }
    if (targetIndex === currentSegmentIndex.value) {
      seek(offset)
    } else if (segments.value[targetIndex].audio_generated) {
      playSegment(targetIndex, offset)
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

  const hasEstimates = computed(() =>
    segments.value.some(seg => !segmentDurations.has(seg.segment_index)),
  )

  const totalDuration = computed(() =>
    segments.value.reduce((sum, seg) => sum + estimateSegmentDuration(seg), 0),
  )

  const elapsedTime = computed(() => {
    let elapsed = 0
    for (let i = 0; i < currentSegmentIndex.value; i++) {
      elapsed += estimateSegmentDuration(segments.value[i])
    }
    elapsed += currentTime.value
    return elapsed
  })

  const remainingTime = computed(() => {
    const raw = totalDuration.value - elapsedTime.value
    return Math.max(0, raw / playbackRate.value)
  })

  return {
    isPlaying: readonly(isPlaying),
    currentTime: readonly(currentTime),
    duration: readonly(duration),
    playbackRate: readonly(playbackRate),
    currentSegmentIndex: readonly(currentSegmentIndex),
    segments: readonly(segments),
    currentReadId: readonly(currentReadId),
    currentReadTitle: readonly(currentReadTitle),
    hasEstimates,
    totalDuration,
    elapsedTime,
    remainingTime,
    setSegments,
    playSegment,
    play,
    pause,
    togglePlayPause,
    seek,
    seekToGlobal,
    setRate,
    skipPrev,
    skipNext,
    stop,
  }
}
