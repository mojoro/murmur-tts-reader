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
const { voices, selectedVoice, selectVoice } = useVoices()

const groupedVoices = computed(() => {
  const builtin = voices.value
    .filter((v) => v.type === 'builtin')
    .map((v) => ({ label: v.name, value: v.name }))
  const cloned = voices.value
    .filter((v) => v.type === 'cloned')
    .map((v) => ({ label: v.name, value: v.name }))

  const groups: Record<string, any>[][] = []
  if (builtin.length > 0) groups.push([{ type: 'label', label: 'Built-in' }, ...builtin])
  if (cloned.length > 0) groups.push([{ type: 'label', label: 'Cloned' }, ...cloned])
  return groups
})

function onSelect(value: string) {
  selectVoice(value)
}
</script>
