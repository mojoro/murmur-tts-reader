<template>
  <div class="max-w-4xl mx-auto flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Library</h1>
      <UButton color="primary" icon="i-lucide-plus" to="/new">
        New Read
      </UButton>
    </div>
    <LibraryGrid :reads="reads" :loading="loading" :jobs="jobs" @delete="handleDelete" />
  </div>
</template>

<script setup lang="ts">
const { reads, loading, refresh: refreshReads, deleteRead } = useLibrary()
const { jobs } = useQueue()

// Refresh reads list when a job completes so generated_at/engine show up
watch(jobs, (curr, prev) => {
  if (!prev) return
  const wasDone = (j: typeof curr[number]) => j.status === 'done'
  if (curr.some(wasDone) && !prev.some(wasDone)) refreshReads()
  // Also refresh if a job just finished (count of done jobs increased)
  const doneNow = curr.filter(wasDone).length
  const doneBefore = prev.filter(wasDone).length
  if (doneNow > doneBefore) refreshReads()
})

async function handleDelete(id: number) {
  await deleteRead(id)
}
</script>
