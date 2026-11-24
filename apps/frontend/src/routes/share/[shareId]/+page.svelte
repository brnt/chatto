<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { serverRegistry } from '$lib/client';
	import { Button } from '$lib/ui/form';
	import { Panel, PaneContent, PaneHeader } from '$lib/ui';
	import { LoadingDots, Hint } from '$lib/ui';
	import { m } from '$lib/i18n/messages';

	let isLoading = $state(true);
	let hasServers = $state(false);

	onMount(() => {
		// Get the list of servers the user has access to
		const servers = serverRegistry.servers;
		if (servers.length === 0) {
			// User is not logged in - redirect to login with a return URL
			const returnUrl = encodeURIComponent(page.url.pathname);
			goto(resolve(`/login?return=${returnUrl}`));
			return;
		}

		hasServers = servers.length > 0;
		isLoading = false;

		// If the user has servers, redirect them to the main chat view where they can
		// pick a room using the normal UI. For now, we'll just navigate to the overview
		// and let them manually select where to send the content.
		if (hasServers) {
			// TODO: Implement proper room picker UI
			// For now, navigate to chat overview and show a hint about the shared content
			goto(resolve('/chat/-'));
		}
	});
</script>

<div class="flex h-full flex-col items-center justify-center bg-background p-4">
	{#if isLoading}
		<LoadingDots />
	{:else if !hasServers}
		<div class="w-full max-w-2xl">
			<Hint>
				{m('chat.share.sharing_content')}
			</Hint>
			<div class="mt-4">
				<Button onclick={() => goto(resolve('/login'))}>
					{m('common.sign_in')}
				</Button>
			</div>
		</div>
	{:else}
		<div class="w-full max-w-2xl">
			<PaneHeader title={m('chat.share.share_to_chatto')} />
			<PaneContent>
				<Panel>
					<div class="space-y-4 p-6">
						<Hint>
							Content ready to share. Opening Chatto...
						</Hint>
					</div>
				</Panel>
			</PaneContent>
		</div>
	{/if}
</div>
