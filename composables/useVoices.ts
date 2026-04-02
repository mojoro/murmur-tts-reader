import { eq } from 'drizzle-orm'
import { voices } from '~/shared/schema'
import type { Voice } from '~/types/db'
import type { VoicesResponse } from '~/types/tts'

const voiceList = ref<Voice[]>([])
const selectedVoice = ref<string>('')
const pending = ref(false)

export function useVoices() {
  const { getDb, persist } = useDatabase()
  const { settings } = useSettings()

  async function fetchVoicesFromDb() {
    const db = await getDb()
    voiceList.value = await db.select().from(voices)
    if (!selectedVoice.value && voiceList.value.length > 0) {
      selectedVoice.value = voiceList.value[0].name
    }
  }

  async function syncVoices() {
    pending.value = true
    try {
      const remote: VoicesResponse = await fetchVoices(settings.value.ttsServerUrl)
      const db = await getDb()

      for (const name of remote.builtin) {
        const [existing] = await db.select().from(voices).where(eq(voices.name, name))
        if (!existing) {
          await db.insert(voices).values({ name, type: 'builtin' })
        }
      }

      for (const name of remote.custom) {
        const [existing] = await db.select().from(voices).where(eq(voices.name, name))
        if (!existing) {
          await db.insert(voices).values({ name, type: 'cloned' })
        }
      }

      await persist()
      await fetchVoicesFromDb()
    } finally {
      pending.value = false
    }
  }

  function selectVoice(name: string) {
    selectedVoice.value = name
  }

  return {
    voices: readonly(voiceList),
    selectedVoice: readonly(selectedVoice),
    pending: readonly(pending),
    fetchVoicesFromDb,
    syncVoices,
    selectVoice,
  }
}
