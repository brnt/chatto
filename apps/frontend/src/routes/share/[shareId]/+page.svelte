<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { serverRegistry } from '$lib/client';
	import { Button } from '$lib/ui/form';
	import { Panel, PaneContent, PaneHeader } from '$lib/ui';
	import { LoadingDots } from '$lib/ui';
	import { EmptyState } from '$lib/ui';
	import { m } from '$lib/i18n/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selectedServerId = $state<string | null>(null);
	let selectedRoomId = $state<string | null>(null);
	let isLoading = $state(true);
	let servers = $state<Array<{ id: string; name: string; url: string }>>([]);
	let rooms = $state<Array<{ id: string; name: string }>>([]);

	onMount(() => {
		// Get the list of servers the user has access to
		const serverIds = serverRegistry.serverIds();
		if (serverIds.length === 0) {
			// User is not logged in - redirect to login with a return URL
			const returnUrl = encodeURIComponent($page.url.pathname);
			goto(resolve(`/login?return=${returnUrl}`));
			return;
		}

		// Load servers
		servers = serverIds
			.map((id) => {
				const server = serverRegistry.getServer(id);
				if (!server) return null;
				return {
					id,
					name: server.store.serverInfo.name,
					url: server.url
				};
			})
			.filter((s): s is NonNullable<typeof s> => s !== null);

		// Pre-select the first server if only one exists
		if (servers.length === 1) {
			selectedServerId = servers[0].id;
			loadRooms(servers[0].id);
		}

		isLoading = false;
	});

	function loadRooms(serverId: string) {
		selectedServerId = serverId;
		const server = serverRegistry.getServer(serverId);
		if (!server) return;

		// Get rooms from the server's store
		const roomIds = server.store.rooms.roomIds();
		rooms = roomIds
			.map((roomId) => {
				const room = server.store.rooms.getRoom(roomId);
				if (!room) return null;
				return {
					id: roomId,
					name: room.name
				};
			})
			.filter((r): r is NonNullable<typeof r> => r !== null);
	}

	function handleShare() {
		if (!selectedServerId || !selectedRoomId) return;

		// Navigate to the room with share data in the URL
		// The room will handle extracting and using the share data
		const shareParams = new URLSearchParams({
			shareId: data.shareData.id
		});
		goto(resolve(`/chat/${selectedServerId}/${selectedRoomId}?${shareParams.toString()}`));
	}

	let canShare = $derived(selectedServerId !== null && selectedRoomId !== null);
</script>

<div class="flex h-full flex-col items-center justify-center bg-background p-4">
	{#if isLoading}
		<LoadingDots />
	{:else}
		<div class="w-full max-w-2xl">
			<PaneHeader>
				<h1 class="text-xl font-semibold">{m.chat.share.share_to_chatto()}</h1>
			</PaneHeader>

			<PaneContent>
				<Panel>
					<div class="space-y-6 p-6">
						<!-- Share preview -->
						<div class="space-y-2">
							<h2 class="text-sm font-medium text-foreground-secondary">
								{m.chat.share.sharing_content()}
							</h2>
							<div class="rounded-lg border border-stroke bg-elevated p-4">
								{#if data.shareData.title}
									<div class="font-medium">{data.shareData.title}</div>
								{/if}
								{#if data.shareData.text}
									<div class="mt-2 text-foreground-secondary">{data.shareData.text}</div>
								{/if}
								{#if data.shareData.url}
									<div class="mt-2">
										<a href={data.shareData.url} class="link" target="_blank" rel="noopener">
											{data.shareData.url}
										</a>
									</div>
								{/if}
								{#if data.shareData.files && data.shareData.files.length > 0}
									<div class="mt-3 space-y-1">
										<div class="text-sm font-medium">{m.chat.share.files()}:</div>
										{#each data.shareData.files as file}
											<div class="text-sm text-foreground-secondary">
												📎 {file.filename} ({Math.round(file.size / 1024)} KB)
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<!-- Server selection -->
						{#if servers.length > 1}
							<div class="space-y-2">
								<label for="server-select" class="text-sm font-medium">
									{m.chat.share.select_server()}
								</label>
								<select
									id="server-select"
									class="input w-full"
									bind:value={selectedServerId}
									onchange={() => selectedServerId && loadRooms(selectedServerId)}
								>
									<option value={null}>{m.chat.share.choose_a_server()}</option>
									{#each servers as server}
										<option value={server.id}>{server.name}</option>
									{/each}
								</select>
							</div>
						{/if}

						<!-- Room selection -->
						{#if selectedServerId}
							<div class="space-y-2">
								<label for="room-select" class="text-sm font-medium">
									{m.chat.share.select_room()}
								</label>
								{#if rooms.length === 0}
									<EmptyState>{m.chat.share.no_rooms_available()}</EmptyState>
								{:else}
									<select id="room-select" class="input w-full" bind:value={selectedRoomId}>
										<option value={null}>{m.chat.share.choose_a_room()}</option>
										{#each rooms as room}
											<option value={room.id}>{room.name}</option>
										{/each}
									</select>
								{/if}
							</div>
						{/if}

						<!-- Action buttons -->
						<div class="flex justify-end gap-2">
							<Button variant="text" onclick={() => goto(resolve('/chat/-'))}>
								{m.common.cancel()}
							</Button>
							<Button disabled={!canShare} onclick={handleShare}>{m.common.share()}</Button>
						</div>
					</div>
				</Panel>
			</PaneContent>
		</div>
	{/if}
</div>
