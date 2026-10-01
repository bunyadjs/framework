<script lang="ts">
  import AppLayout from "@/layouts/AppLayout.svelte";
</script>

<AppLayout title="Dashboard">
  <div class="flex h-full flex-col gap-4">
    <div class="grid gap-4 md:grid-cols-3">
      {#each [1, 2, 3] as card (card)}
        <div class="aspect-video rounded-box border border-dashed border-base-300 bg-base-100"></div>
      {/each}
    </div>
    <div class="min-h-96 flex-1 rounded-box border border-dashed border-base-300 bg-base-100"></div>
  </div>
</AppLayout>
