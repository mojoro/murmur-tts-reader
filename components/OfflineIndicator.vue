<template>
  <div v-if="!isOnline || isSyncing" class="flex items-center gap-1.5">
    <template v-if="isSyncing">
      <UIcon name="i-lucide-refresh-cw" class="size-3.5 text-sky-500 animate-spin" />
      <span class="text-xs text-sky-500 hidden sm:inline">
        Syncing{{ pendingCount > 0 ? ` (${pendingCount})` : '' }}
      </span>
    </template>
    <template v-else>
      <UIcon name="i-lucide-wifi-off" class="size-3.5 text-amber-500" />
      <span class="text-xs text-amber-500 hidden sm:inline">Offline</span>
    </template>
  </div>
</template>

<script setup lang="ts">
const { isOnline, isSyncing, pendingCount } = useOffline()
</script>
