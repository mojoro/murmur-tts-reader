import type { HealthResponse, VoicesResponse, CloneVoiceResponse } from '~/types/tts'

export async function fetchHealth(baseUrl: string): Promise<HealthResponse> {
  try {
    const res = await fetch(`${baseUrl}/health`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { status: 'unreachable', model_loaded: false, backend: 'unknown' }
  }
}

export async function fetchVoices(baseUrl: string): Promise<VoicesResponse> {
  const res = await fetch(`${baseUrl}/tts/voices`)
  if (!res.ok) throw new Error(`Failed to fetch voices: HTTP ${res.status}`)
  return await res.json()
}

export async function generateAudio(
  baseUrl: string,
  text: string,
  voice: string,
  language?: string,
): Promise<Blob> {
  const res = await fetch(`${baseUrl}/tts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, language }),
  })
  if (!res.ok) throw new Error(`TTS generation failed: HTTP ${res.status}`)
  return await res.blob()
}

export async function cloneVoice(
  baseUrl: string,
  name: string,
  wavBlob: Blob,
  promptText?: string,
): Promise<CloneVoiceResponse> {
  const form = new FormData()
  form.append('name', name)
  form.append('file', wavBlob, `${name}.wav`)
  if (promptText) form.append('prompt_text', promptText)
  const res = await fetch(`${baseUrl}/tts/clone-voice`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Voice cloning failed: HTTP ${res.status}`)
  return await res.json()
}
