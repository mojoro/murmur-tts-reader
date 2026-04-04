<template>
  <div class="max-w-4xl mx-auto flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Library</h1>
      <UButton color="primary" icon="i-lucide-plus" to="/new">
        New Read
      </UButton>
    </div>
    <LibraryGrid :reads="reads" :loading="loading" @delete="handleDelete" />
  </div>
</template>

<script setup lang="ts">
const { reads, loading, deleteRead } = useLibrary()

async function handleDelete(id: number) {
  await deleteRead(id)
}
</script>
