<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount, untrack } from 'svelte';
	import { client, serverRegistry } from '$lib/client';
	import { serverUi } from '$lib/state/server/serverUi';
	import { serverIdToSegment } from '$lib/navigation';
	import { stashShare } from '$lib/state/pendingShare';
	import { sortRooms } from '$lib/share/sortRooms';
	import { getLastUsedRoom, saveLastUsedRoom } from '$lib/share/lastUsedRoom';
	import { pickInitialRoom } from '$lib/share/pickInitialRoom';
	import { Button, Select } from '$lib/ui/form';
	import { Panel, PaneContent, PaneHeader } from '$lib/ui';
	import { LoadingDots, EmptyState } from '$lib/ui';
	import { m } from '$lib/i18n/messages';
	import type { PageData } from './$types';
	import type { RoomsListItem } from '$lib/state/server/navigation';

	let { data }: { data: PageData } = $props();

	type ServerInfo = { id: string; name: string; url: string };
	type RoomOption = { id: string; name: string; serverId: string };

	let isPageLoading = $state(true);
	let servers = $state<ServerInfo[]>([]);
	let selectedServerId = $state<string>('');
	let selectedRoomId = $state<string>('');
	let rooms = $state<RoomOption[]>([]);
	let roomsLoading = $state(false);
	let roomsLoadError = $state(false);

	onMount(() => {
		// Start the client to ensure realtime sync runs
		untrack(() => client.start());

		// Get the list of servers the user has access to
		const serverList = serverRegistry.servers;
		if (serverList.length === 0) {
			// User is not logged in - redirect to login with a return URL
			const returnUrl = encodeURIComponent(page.url.pathname);
			goto(resolve(`/login?return=${returnUrl}`));
			return;
		}

		// Load server list
		servers = serverList
			.map((server) => {
				const store = serverRegistry.getStore(server.id);
				if (!store) return null;
				return {
					id: server.id,
					name: store.serverInfo.name,
					url: server.url
				};
			})
			.filter((s): s is ServerInfo => s !== null);

		// Pre-select first server if only one
		if (servers.length === 1) {
			selectedServerId = servers[0].id;
			loadRooms(servers[0].id);
		}

		isPageLoading = false;
	});

	function loadRooms(serverId: string) {
		selectedServerId = serverId;
		selectedRoomId = '';
		roomsLoading = true;
		roomsLoadError = false;
		rooms = [];
		
		const store = serverRegistry.getStore(serverId);
		if (!store) {
			roomsLoading = false;
			roomsLoadError = true;
			return;
		}

		// Set this server as active to ensure its realtime sync runs
		untrack(() => client.setActiveServer(serverId));
	}

	// React to room list loading state for the selected server
	$effect(() => {
		const serverId = selectedServerId;
		if (!serverId) return;

		const store = serverRegistry.getStore(serverId);
		if (!store) return;

		const navigation = serverUi(store).navigation;
		const isLoading = navigation.isInitialLoading;
		const roomList = navigation.rooms;

		// Update loading state
		roomsLoading = isLoading;

		// Once loaded, update room list
		if (!isLoading) {
			// Capture current selectedRoomId without tracking (picking a room won't re-run effect)
			const currentSelectedRoomId = untrack(() => selectedRoomId);

			// Map to room options
			const mappedRooms = roomList.map((room: RoomsListItem) => ({
				id: room.id,
				name: room.name,
				serverId
			}));

			// Sort alphabetically by name
			const sortedRooms = sortRooms(mappedRooms);

			// Get last used room for this server
			const lastUsedRoomId = getLastUsedRoom(serverId);

			// If last used room exists in the list, pin it to the top
			if (lastUsedRoomId) {
				const lastUsedIndex = sortedRooms.findIndex((r) => r.id === lastUsedRoomId);
				if (lastUsedIndex >= 0) {
					// Remove from sorted position and add to top with "Last used" prefix
					const [lastUsedRoom] = sortedRooms.splice(lastUsedIndex, 1);
					rooms = [
						{ ...lastUsedRoom, name: `${m('chat.share.last_used')}: ${lastUsedRoom.name}` },
						...sortedRooms
					];

					// Preselect the last-used room if no room is currently selected
					const roomIds = sortedRooms.map((r) => r.id);
					roomIds.unshift(lastUsedRoomId); // Include the pinned room
					const initialRoom = pickInitialRoom(currentSelectedRoomId, lastUsedRoomId, roomIds);
					if (initialRoom) {
						selectedRoomId = initialRoom;
					}
				} else {
					// Last used room not in list anymore, just use sorted list
					rooms = sortedRooms;
				}
			} else {
				rooms = sortedRooms;
			}

			roomsLoadError = roomList.length === 0;
		}

		// Set a timeout for error state if loading takes too long
		const timeout = setTimeout(() => {
			if (navigation.isInitialLoading) {
				roomsLoadError = true;
				roomsLoading = false;
			}
		}, 10000);

		return () => clearTimeout(timeout);
	});

	function retryLoadRooms() {
		if (selectedServerId) {
			loadRooms(selectedServerId);
		}
	}

	function handleShare() {
		if (!selectedServerId || !selectedRoomId) return;

		// Save last used room for this server
		saveLastUsedRoom(selectedServerId, selectedRoomId);

		// Stash share data to avoid double-fetching (single-use shares are deleted on first read)
		stashShare(data.shareData);

		// Navigate to the room with shareId parameter
		// Use serverIdToSegment to convert internal server ID to URL segment
		const serverSegment = serverIdToSegment(selectedServerId);
		const base = resolve('/chat/[serverId]/[roomId]', { 
			serverId: serverSegment, 
			roomId: selectedRoomId 
		});
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- query parameter cannot be included in resolve()
		void goto(`${base}?shareId=${encodeURIComponent(data.shareData.id)}`);
	}

	let canShare = $derived(selectedServerId !== '' && selectedRoomId !== '');
</script>

<div class="flex h-full flex-col items-center justify-center bg-background p-4">
	{#if isPageLoading}
		<LoadingDots />
	{:else}
		<div class="w-full max-w-2xl">
			<PaneHeader title={m('chat.share.share_to_chatto')} />
			<PaneContent>
				<Panel>
					<div class="space-y-6 p-6">
						<!-- Share preview -->
						<div class="space-y-2">
							<h2 class="text-sm font-medium text-muted">
								{m('chat.share.sharing_content')}
							</h2>
							<div class="rounded-lg border border-border bg-surface p-4">
								{#if data.shareData.title}
									<div class="font-medium">{data.shareData.title}</div>
								{/if}
								{#if data.shareData.text}
									<div class="mt-2 text-muted">{data.shareData.text}</div>
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
										<div class="text-sm font-medium">{m('chat.share.files')}:</div>
										{#each data.shareData.files as file, i (`${i}-${file.filename}`)}
											<div class="text-sm text-muted">
												📎 {file.filename} ({Math.round(file.size / 1024)} KB)
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<!-- Server selection (if multiple servers) -->
						{#if servers.length > 1}
							<Select
								id="server-select"
								label={m('chat.share.select_server')}
								bind:value={selectedServerId}
								options={[
									{ value: '', label: m('chat.share.choose_a_server') },
									...servers.map((s) => ({ value: s.id, label: s.name }))
								]}
								onValueChange={(value) => {
									if (value) loadRooms(value);
								}}
							/>
						{/if}

						<!-- Room selection -->
						{#if selectedServerId}
							{#if roomsLoading}
								<div class="flex items-center justify-center py-8">
									<LoadingDots />
								</div>
							{:else if roomsLoadError && rooms.length === 0}
								<div class="space-y-4">
									<EmptyState>{m('chat.share.no_rooms_available')}</EmptyState>
									<div class="flex justify-center">
										<Button variant="ghost" onclick={retryLoadRooms}>
											{m('common.retry')}
										</Button>
									</div>
								</div>
							{:else if rooms.length > 0}
								<Select
									id="room-select"
									label={m('chat.share.select_room')}
									bind:value={selectedRoomId}
									options={[
										{ value: '', label: m('chat.share.choose_a_room') },
										...rooms.map((r) => ({ value: r.id, label: r.name }))
									]}
								/>
							{/if}
						{/if}

						<!-- Action buttons -->
						<div class="flex justify-end gap-2">
							<Button variant="ghost" onclick={() => goto(resolve('/chat/-'))}>
								{m('common.cancel')}
							</Button>
							<Button disabled={!canShare} onclick={handleShare}>{m('common.share')}</Button>
						</div>
					</div>
				</Panel>
			</PaneContent>
		</div>
	{/if}
</div>
