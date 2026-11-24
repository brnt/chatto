<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { serverRegistry } from '$lib/client';
	import { serverUi } from '$lib/state/server/serverUi';
	import { Button, Select } from '$lib/ui/form';
	import { Panel, PaneContent, PaneHeader } from '$lib/ui';
	import { LoadingDots, EmptyState } from '$lib/ui';
	import { m } from '$lib/i18n/messages';
	import type { PageData } from './$types';
	import type { RoomsListItem } from '$lib/state/server/navigation';

	let { data }: { data: PageData } = $props();

	type ServerInfo = { id: string; name: string; url: string };
	type RoomOption = { id: string; name: string; serverId: string };

	let isLoading = $state(true);
	let servers = $state<ServerInfo[]>([]);
	let selectedServerId = $state<string>('');
	let selectedRoomId = $state<string>('');
	let rooms = $state<RoomOption[]>([]);

	onMount(() => {
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

		isLoading = false;
	});

	function loadRooms(serverId: string) {
		selectedServerId = serverId;
		selectedRoomId = '';
		
		const store = serverRegistry.getStore(serverId);
		if (!store) {
			rooms = [];
			return;
		}

		// Get rooms from navigation store
		const navigation = serverUi(store).navigation;
		const roomList = navigation.rooms;

		rooms = roomList.map((room: RoomsListItem) => ({
			id: room.id,
			name: room.name,
			serverId
		}));
	}

	function handleShare() {
		if (!selectedServerId || !selectedRoomId) return;

		// Navigate to the room with shareId parameter
		const url = resolve(`/chat/${selectedServerId}/${selectedRoomId}?shareId=${data.shareData.id}`);
		goto(url);
	}

	let canShare = $derived(selectedServerId !== '' && selectedRoomId !== '');
</script>

<div class="flex h-full flex-col items-center justify-center bg-background p-4">
	{#if isLoading}
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
										{#each data.shareData.files as file}
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
							{#if rooms.length === 0}
								<EmptyState>{m('chat.share.no_rooms_available')}</EmptyState>
							{:else}
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
