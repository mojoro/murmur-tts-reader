<template>
  <nav class="flex-1 overflow-y-auto p-3">
    <UNavigationMenu
      :items="items"
      orientation="vertical"
      class="w-full"
    />
  </nav>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  navigate: []
}>()

const route = useRoute()

const items = computed(() => [
  {
    label: 'Library',
    icon: 'i-lucide-library',
    to: '/',
    active: route.path === '/',
    click: () => emit('navigate'),
  },
  {
    label: 'New Read',
    icon: 'i-lucide-plus-circle',
    to: '/new',
    active: route.path === '/new',
    click: () => emit('navigate'),
  },
  {
    label: 'Voices',
    icon: 'i-lucide-mic',
    to: '/voices',
    active: route.path === '/voices',
    click: () => emit('navigate'),
  },
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    to: '/settings',
    active: route.path === '/settings',
    click: () => emit('navigate'),
  },
])
</script>
