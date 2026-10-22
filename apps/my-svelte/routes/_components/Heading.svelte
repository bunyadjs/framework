<script lang="ts">
  let { title, description }: { title: string; description?: string } = $props();
</script>

<div class="text-center">
  <h1 class="text-xl font-semibold">{title}</h1>
  {#if description}<p class="mt-1 text-sm text-base-content/70">{description}</p>{/if}
</div>
