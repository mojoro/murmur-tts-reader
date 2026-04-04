<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Search reads..." class="flex-1" />
      <USelectMenu v-model="sortBy" :items="sortOptions" class="w-40" />
    </div>

    <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <USkeleton v-for="i in 6" :key="i" class="h-32 w-full rounded-lg" />
    </div>

    <div
      v-else-if="filteredReads.length === 0 && !search"
      class="flex flex-col items-center justify-center py-16 gap-4 text-neutral-500"
    >
      <UIcon name="i-lucide-book-open" class="size-12" />
      <p class="text-lg">No reads yet</p>
      <p class="text-sm">Create your first read to get started</p>
      <UButton color="primary" to="/new">Create a Read</UButton>
    </div>

    <div
      v-else-if="filteredReads.length === 0 && search"
      class="flex flex-col items-center justify-center py-16 gap-4 text-neutral-500"
    >
      <UIcon name="i-lucide-search-x" class="size-12" />
      <p class="text-lg">No results</p>
      <p class="text-sm">Try a different search term</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <LibraryCard v-for="read in filteredReads" :key="read.id" :read="read" @delete="confirmDelete" />
    </div>

    <UModal v-model:open="deleteModalOpen">
      <template #content>
        <div class="p-6 flex flex-col gap-4">
          <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Delete Read</h3>
          <p class="text-neutral-500">Are you sure you want to delete this read? This action cannot be undone.</p>
          <div class="flex justify-end gap-3">
            <UButton variant="ghost" color="neutral" @click="deleteModalOpen = false">Cancel</UButton>
            <UButton color="error" @click="handleDelete">Delete</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { ReadSummary } from '~/types/api'

const props = defineProps<{
  reads: ReadSummary[]
  loading: boolean
}>()

const emit = defineEmits<{
  delete: [id: number]
}>()

const search = ref('')
const sortBy = ref('newest')
const deleteModalOpen = ref(false)
const deleteTargetId = ref<number | null>(null)

const sortOptions = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'A-Z', value: 'az' },
]

const filteredReads = computed(() => {
  let result = [...props.reads]

  if (search.value) {
    const q = search.value.toLowerCase()
    result = result.filter((r) => r.title.toLowerCase().includes(q))
  }

  switch (sortBy.value) {
    case 'oldest':
      result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      break
    case 'az':
      result.sort((a, b) => a.title.localeCompare(b.title))
      break
  }

  return result
})

function confirmDelete(id: number) {
  deleteTargetId.value = id
  deleteModalOpen.value = true
}

function handleDelete() {
  if (deleteTargetId.value !== null) {
    emit('delete', deleteTargetId.value)
  }
  deleteModalOpen.value = false
  deleteTargetId.value = null
}
</script>
