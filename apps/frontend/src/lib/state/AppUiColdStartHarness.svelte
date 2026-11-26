<script lang="ts">
  import { onMount } from 'svelte';
  import { AppUiState } from './appUi.svelte';

  let {
    appUi,
    defaultPanel = 'members' as 'members' | null
  }: {
    appUi: AppUiState;
    defaultPanel?: 'members' | null;
  } = $props();

  // Mirror Room.svelte: derived read can happen before layout loads preference.
  const panel = $derived(appUi.desktopRoomSidebarPanel(defaultPanel));

  onMount(() => {
    appUi.setActiveRoomScope('server-a', 'room-1');
  });
</script>

<div data-testid="panel-state">{panel === null ? 'closed' : (panel ?? 'none')}</div>
