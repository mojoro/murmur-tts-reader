import type { AudioSegment } from '~/types/db'

const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const playbackRate = ref(1.0)
const currentSegmentIndex = ref(0)
const segments = ref<AudioSegment[]>([])
const currentObjectUrl = ref<string | null>(null)

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
      // Auto-advance to next segment
      const nextIndex = currentSegmentIndex.value + 1
      if (nextIndex < segments.value.length && segments.value[nextIndex].audioPath) {
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
  const { loadAudio, audioUrl } = useAudioStorage()
  const segment = segments.value[index]
  if (!segment?.audioPath) return

  const [readId, segIdx] = segment.audioPath.split(':').map(Number)
  const blob = await loadAudio(readId, segIdx)
  if (!blob) return

  // Revoke previous URL to prevent memory leaks
  if (currentObjectUrl.value) {
    URL.revokeObjectURL(currentObjectUrl.value)
  }

  const url = audioUrl(blob)
  currentObjectUrl.value = url
  currentSegmentIndex.value = index

  const el = ensureAudio()
  el.src = url
  el.playbackRate = playbackRate.value
  await el.play()
}

export function useAudioPlayer() {
  function setSegments(segs: AudioSegment[]) {
    segments.value = segs
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
  }

  function skipPrev() {
    const prevIndex = currentSegmentIndex.value - 1
    if (prevIndex >= 0) playSegment(prevIndex)
  }

  function skipNext() {
    const nextIndex = currentSegmentIndex.value + 1
    if (nextIndex < segments.value.length && segments.value[nextIndex].audioPath) {
      playSegment(nextIndex)
    }
  }

  function stop() {
    if (!import.meta.client) return
    if (audio) {
      audio.pause()
      audio.src = ''
    }
    if (currentObjectUrl.value) {
      URL.revokeObjectURL(currentObjectUrl.value)
      currentObjectUrl.value = null
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
