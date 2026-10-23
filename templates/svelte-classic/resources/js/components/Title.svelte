<script lang="ts">
  import { page } from "@inertiajs/svelte";

  /** Sets the document title: "Page - App name". */
  let { title }: { title: string } = $props();
</script>

<svelte:head><title>{title} - {page.props.name}</title></svelte:head>
