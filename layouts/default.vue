<template>
  <div class="flex h-screen overflow-hidden bg-white dark:bg-neutral-950">
    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex lg:w-64 lg:flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div class="flex items-center h-14 px-4 border-b border-neutral-200 dark:border-neutral-800">
        <NuxtLink to="/" class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          pocket-tts
        </NuxtLink>
      </div>
      <AppSidebar />
    </aside>

    <!-- Mobile sidebar drawer -->
    <USlideover v-model:open="sidebarOpen" side="left" class="lg:hidden">
      <div class="flex flex-col h-full">
        <div class="flex items-center h-14 px-4 border-b border-neutral-200 dark:border-neutral-800">
          <span class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">pocket-tts</span>
        </div>
        <AppSidebar @navigate="sidebarOpen = false" />
      </div>
    </USlideover>

    <!-- Main content area -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <AppHeader @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main class="flex-1 overflow-y-auto p-4 lg:p-8">
        <Transition
          enter-active-class="transition-opacity duration-150 ease-out"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition-opacity duration-100 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
          mode="out-in"
        >
          <slot />
        </Transition>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const sidebarOpen = ref(false)
</script>
