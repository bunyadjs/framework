<script lang="ts">
  let { message }: { message?: string | null } = $props();
</script>

{#if message}<div role="status" class="alert alert-success alert-soft text-sm">{message}</div>{/if}
