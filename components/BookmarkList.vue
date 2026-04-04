<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="bookmark in bookmarks"
      :key="bookmark.id"
      class="group flex items-start gap-3 p-3 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer transition-colors"
      @click="jumpTo(bookmark)"
    >
      <UIcon name="i-lucide-bookmark" class="size-4 mt-0.5 text-primary-500 shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-sm text-neutral-900 dark:text-neutral-50">
          Segment {{ bookmark.segment_index + 1 }}
        </p>
        <p v-if="bookmark.note" class="text-xs text-neutral-500 line-clamp-2 mt-0.5">
          {{ bookmark.note }}
        </p>
      </div>
      <UButton
        icon="i-lucide-trash-2"
        variant="ghost"
        color="error"
        size="xs"
        class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        @click.stop="emit('delete', bookmark.id)"
      />
    </div>

    <div v-if="bookmarks.length === 0" class="py-8 text-center text-neutral-500 text-sm">
      No bookmarks yet
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Bookmark } from '~/types/api'

defineProps<{
  bookmarks: Bookmark[]
}>()

const emit = defineEmits<{
  delete: [id: number]
}>()

const { playSegment } = useAudioPlayer()

function jumpTo(bookmark: Bookmark) {
  playSegment(bookmark.segment_index)
}
</script>
