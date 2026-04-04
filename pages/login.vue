<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-white dark:bg-neutral-950">
    <UCard class="w-full max-w-sm">
      <div class="flex flex-col gap-6">
        <div class="text-center">
          <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">pocket-tts</h1>
          <p class="text-sm text-neutral-500 mt-1">Sign in to your account</p>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="handleLogin">
          <UFormField label="Email">
            <UInput v-model="email" type="email" placeholder="you@example.com" required class="w-full" />
          </UFormField>
          <UFormField label="Password">
            <UInput v-model="password" type="password" required class="w-full" />
          </UFormField>

          <UAlert v-if="errorMsg" color="error" :title="errorMsg" icon="i-lucide-alert-circle" />

          <UButton type="submit" color="primary" block :loading="loading">
            Sign In
          </UButton>
        </form>

        <p class="text-center text-sm text-neutral-500">
          Don't have an account?
          <NuxtLink to="/register" class="text-primary-500 hover:underline">Register</NuxtLink>
        </p>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const { login } = useAuth()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    await login(email.value, password.value)
    await navigateTo('/')
  } catch (e: any) {
    errorMsg.value = e.data?.statusMessage || e.message || 'Login failed'
  } finally {
    loading.value = false
  }
}
</script>
