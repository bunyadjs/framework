<script lang="ts">
  let { message }: { message?: string } = $props();
</script>

{#if message}<p class="text-sm text-error">{message}</p>{/if}
