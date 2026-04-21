<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-6 flex flex-col gap-4">
        <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Add Bookmark</h3>
        <p class="text-sm text-neutral-500">
          Bookmark at segment {{ segmentIndex + 1 }}
        </p>
        <UFormField label="Note (optional)">
          <UTextarea v-model="note" placeholder="Add a note..." :rows="3" />
        </UFormField>
        <div class="flex justify-end gap-3">
          <UButton variant="ghost" color="neutral" @click="open = false">Cancel</UButton>
          <UButton color="primary" @click="handleAdd">Add Bookmark</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  segmentIndex: number
}>()

const emit = defineEmits<{
  add: [segmentIndex: number, note?: string]
}>()

const note = ref('')

function handleAdd() {
  emit('add', props.segmentIndex, note.value.trim() || undefined)
  note.value = ''
  open.value = false
}
</script>
