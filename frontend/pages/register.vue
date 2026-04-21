<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-white dark:bg-neutral-950">
    <UCard class="w-full max-w-sm">
      <div class="flex flex-col gap-6">
        <div class="text-center">
          <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Murmur</h1>
          <p class="text-sm text-neutral-500 mt-1">Create your account</p>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="handleRegister">
          <UFormField label="Display Name">
            <UInput v-model="displayName" placeholder="Your name (optional)" class="w-full" />
          </UFormField>
          <UFormField label="Email">
            <UInput v-model="email" type="email" placeholder="you@example.com" required class="w-full" />
          </UFormField>
          <UFormField label="Password">
            <UInput v-model="password" type="password" required class="w-full" />
          </UFormField>

          <UAlert v-if="errorMsg" color="error" :title="errorMsg" icon="i-lucide-alert-circle" />

          <UButton type="submit" color="primary" block :loading="loading">
            Create Account
          </UButton>
        </form>

        <p class="text-center text-sm text-neutral-500">
          Already have an account?
          <NuxtLink to="/login" class="text-primary-500 hover:underline">Sign in</NuxtLink>
        </p>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const { register } = useAuth()

const displayName = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleRegister() {
  loading.value = true
  errorMsg.value = ''
  try {
    await register(email.value, password.value, displayName.value || undefined)
    await navigateTo('/')
  } catch (e: any) {
    errorMsg.value = e.data?.statusMessage || e.message || 'Registration failed'
  } finally {
    loading.value = false
  }
}
</script>
