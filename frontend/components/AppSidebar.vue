<template>
  <nav class="flex flex-col flex-1 overflow-y-auto p-3">
    <UNavigationMenu
      :items="items"
      orientation="vertical"
      class="w-full"
    />
    <div class="mt-auto pt-3 border-t border-neutral-200 dark:border-neutral-800">
      <UButton
        icon="i-lucide-log-out"
        variant="ghost"
        color="neutral"
        block
        class="justify-start"
        @click="handleLogout"
      >
        Sign Out
      </UButton>
    </div>
  </nav>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  navigate: []
}>()

const route = useRoute()
const { logout } = useAuth()

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
    label: 'Queue',
    icon: 'i-lucide-list',
    to: '/queue',
    active: route.path === '/queue',
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

async function handleLogout() {
  emit('navigate')
  await logout()
}
</script>
