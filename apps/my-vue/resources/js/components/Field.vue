<script setup lang="ts">
import InputError from "@/components/InputError.vue";

/** A labelled DaisyUI input with its validation message. Other attributes go to the `<input>`. */
defineOptions({ inheritAttrs: false });
defineProps<{ id: string; label: string; error?: string; inputClass?: string }>();
const model = defineModel<string>();
</script>

<template>
  <fieldset class="fieldset">
    <div class="flex items-center justify-between">
      <label class="label" :for="id">{{ label }}</label>
      <slot name="aside" />
    </div>
    <input :id="id" :name="id" v-model="model" v-bind="$attrs" :class="['input w-full', inputClass]" />
    <InputError :message="error" />
  </fieldset>
</template>
