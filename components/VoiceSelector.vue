<template>
  <USelectMenu
    :model-value="selectedVoice"
    :items="groupedVoices"
    placeholder="Select a voice..."
    value-key="value"
    @update:model-value="onSelect"
  />
</template>

<script setup lang="ts">
const { voices, selectedVoice, selectVoice, fetchVoicesFromDb, syncVoices } = useVoices()

const groupedVoices = computed(() => {
  const builtin = voices.value
    .filter((v) => v.type === 'builtin')
    .map((v) => ({ label: v.name, value: v.name }))
  const cloned = voices.value
    .filter((v) => v.type === 'cloned')
    .map((v) => ({ label: v.name, value: v.name }))

  const groups: { label: string; items: { label: string; value: string }[] }[] = []
  if (builtin.length > 0) groups.push({ label: 'Built-in', items: builtin })
  if (cloned.length > 0) groups.push({ label: 'Cloned', items: cloned })
  return groups
})

function onSelect(value: string) {
  selectVoice(value)
}

// Fetch voices on mount
onMounted(async () => {
  if (voices.value.length === 0) {
    try {
      await syncVoices()
    } catch {
      await fetchVoicesFromDb()
    }
  }
})
</script>
