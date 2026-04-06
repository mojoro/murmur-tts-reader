<template>
  <div class="flex h-screen overflow-hidden bg-white dark:bg-neutral-950">
    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex lg:w-64 lg:flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div class="flex items-center h-14 px-4 border-b border-neutral-200 dark:border-neutral-800">
        <NuxtLink to="/" class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Murmur
        </NuxtLink>
      </div>
      <AppSidebar />
    </aside>

    <!-- Mobile sidebar drawer -->
    <USlideover v-model:open="sidebarOpen" side="left" class="lg:hidden">
      <template #content>
        <div class="flex flex-col h-full">
          <div class="flex items-center h-14 px-4 border-b border-neutral-200 dark:border-neutral-800">
            <span class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Murmur</span>
          </div>
          <AppSidebar @navigate="sidebarOpen = false" />
        </div>
      </template>
    </USlideover>

    <!-- Main content area -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <AppHeader @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main class="flex-1 overflow-y-auto p-4 lg:p-8">
        <slot />
      </main>
      <AudioPlayer />
    </div>
  </div>
</template>

<script setup lang="ts">
const sidebarOpen = ref(false)
</script>
