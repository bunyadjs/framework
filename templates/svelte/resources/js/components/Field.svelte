<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import InputError from "@/components/InputError.svelte";

  /** A labelled DaisyUI input with its validation message. Other attributes go to the `<input>`. */
  type Props = HTMLInputAttributes & {
    id: string;
    label: string;
    error?: string;
    value?: string;
    inputClass?: string;
    aside?: Snippet;
  };

  let { id, label, error, value = $bindable(""), inputClass = "", aside, ...input }: Props = $props();
</script>

<fieldset class="fieldset">
  <div class="flex items-center justify-between">
    <label class="label" for={id}>{label}</label>
    {@render aside?.()}
  </div>
  <input {id} name={id} bind:value class="input w-full {inputClass}" {...input} />
  <InputError message={error} />
</fieldset>
