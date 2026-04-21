<template>
  <div class="flex flex-col gap-2">
    <UTextarea
      :model-value="modelValue"
      placeholder="Paste or type your text here..."
      autoresize
      :rows="8"
      @update:model-value="emit('update:modelValue', $event as string)"
    />
    <div class="flex justify-between text-xs text-neutral-500">
      <span>{{ charCount }} characters</span>
      <span>~{{ readTime }} min read</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const charCount = computed(() => props.modelValue.length)
const wordCount = computed(() => props.modelValue.trim() ? props.modelValue.trim().split(/\s+/).length : 0)
const readTime = computed(() => Math.max(1, Math.ceil(wordCount.value / 150)))
</script>
