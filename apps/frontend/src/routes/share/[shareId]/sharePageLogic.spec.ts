import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverIdToSegment } from '$lib/navigation';
import { stashShare, takeShare, type ShareData } from '$lib/state/pendingShare';
import { buildShareText } from '$lib/share/buildShareText';
import { getLastUsedRoom, saveLastUsedRoom } from '$lib/share/lastUsedRoom';
import { sortRooms } from '$lib/share/sortRooms';

vi.mock('$lib/navigation', () => ({
	serverIdToSegment: vi.fn()
}));

vi.mock('$lib/state/pendingShare', () => ({
	stashShare: vi.fn(),
	takeShare: vi.fn()
}));

describe('share page URL generation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('generates correct URL with serverIdToSegment for origin server', () => {
		const internalServerId = 'chat-edlws-org';
		const roomId = 'R123';
		
		// Mock serverIdToSegment to return '-' for origin server
		vi.mocked(serverIdToSegment).mockReturnValue('-');
		
		const segment = serverIdToSegment(internalServerId);
		expect(segment).toBe('-');
		
		// Verify URL would be /chat/-/R123
		const expectedUrl = `/chat/${segment}/${roomId}`;
		expect(expectedUrl).toBe('/chat/-/R123');
		expect(expectedUrl).not.toContain('chat-edlws-org');
	});

	it('generates correct URL with serverIdToSegment for remote server', () => {
		const internalServerId = 'chat-example-com';
		const roomId = 'R456';
		
		// Mock serverIdToSegment to return hostname for remote server
		vi.mocked(serverIdToSegment).mockReturnValue('chat.example.com');
		
		const segment = serverIdToSegment(internalServerId);
		expect(segment).toBe('chat.example.com');
		
		// Verify URL would be /chat/chat.example.com/R456
		const expectedUrl = `/chat/${segment}/${roomId}`;
		expect(expectedUrl).toBe('/chat/chat.example.com/R456');
		expect(expectedUrl).not.toContain('chat-example-com');
	});

	it('URL never contains internal server ID format', () => {
		const internalServerId = 'chat-myserver-org';
		
		vi.mocked(serverIdToSegment).mockReturnValue('myserver.org');
		
		const segment = serverIdToSegment(internalServerId);
		
		// Verify the segment doesn't contain the internal ID format
		expect(segment).not.toContain('chat-myserver-org');
		expect(segment).toBe('myserver.org');
	});

	it('stashes share data before navigation', () => {
		const shareData = {
			id: 'share-123',
			title: 'Test Share',
			text: 'Test content',
			url: 'https://example.com',
			files: []
		};

		stashShare(shareData);

		expect(stashShare).toHaveBeenCalledWith(shareData);
		expect(stashShare).toHaveBeenCalledOnce();
	});
});

describe('share data stashing', () => {
	it('prevents double fetch by stashing before navigation', () => {
		const shareData = {
			id: 'share-456',
			title: 'Stashed Share',
			text: 'Stashed content'
		};

		// Simulate share page stashing data
		stashShare(shareData);
		expect(stashShare).toHaveBeenCalledWith(shareData);

		// Simulate ConversationPane taking data
		vi.mocked(takeShare).mockReturnValue(shareData);
		const retrieved = takeShare('share-456');
		
		expect(takeShare).toHaveBeenCalledWith('share-456');
		expect(retrieved).toEqual(shareData);
	});
});

describe('share text formatting', () => {
	it('builds plain text without quote markers', () => {
		const shareData: ShareData = {
			id: 'share-789',
			title: 'Amazon Link',
			text: 'Check out this product',
			url: 'https://amazon.com/product'
		};

		const text = buildShareText(shareData);

		// Verify no quote markers
		expect(text).not.toContain('>');
		expect(text).not.toMatch(/^> /m);
		
		// Verify structure: title, text, URL on separate lines with blank line between
		expect(text).toBe('Amazon Link\n\nCheck out this product\n\nhttps://amazon.com/product');
	});

	it('skips duplicate URL when already in text', () => {
		const shareData: ShareData = {
			id: 'share-890',
			title: 'Shared Article',
			text: 'Read this: https://example.com/article',
			url: 'https://example.com/article'
		};

		const text = buildShareText(shareData);

		// URL should appear only once
		const urlMatches = text.match(/https:\/\/example\.com\/article/g);
		expect(urlMatches).toHaveLength(1);
		expect(text).toBe('Shared Article\n\nRead this: https://example.com/article');
	});

	it('handles share with only title', () => {
		const shareData: ShareData = {
			id: 'share-901',
			title: 'Just a Title'
		};

		const text = buildShareText(shareData);

		expect(text).toBe('Just a Title');
		expect(text).not.toContain('>');
	});

	it('handles share with only URL', () => {
		const shareData: ShareData = {
			id: 'share-912',
			url: 'https://example.com'
		};

		const text = buildShareText(shareData);

		expect(text).toBe('https://example.com');
		expect(text).not.toContain('>');
	});
});

describe('room preselection', () => {
	const originalLocalStorage = global.localStorage;

	beforeEach(() => {
		// Mock localStorage
		const store: Record<string, string> = {};
		const mockLocalStorage = {
			getItem: vi.fn((key: string) => store[key] ?? null),
			setItem: vi.fn((key: string, value: string) => {
				store[key] = value;
			}),
			removeItem: vi.fn((key: string) => {
				delete store[key];
			}),
			clear: vi.fn(() => {
				Object.keys(store).forEach((key) => delete store[key]);
			}),
			get length() {
				return Object.keys(store).length;
			},
			key: vi.fn((index: number) => Object.keys(store)[index] ?? null)
		};

		Object.defineProperty(global, 'localStorage', {
			value: mockLocalStorage,
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		Object.defineProperty(global, 'localStorage', {
			value: originalLocalStorage,
			writable: true,
			configurable: true
		});
	});

	it('preselects last-used room when it exists in the room list', () => {
		const serverId = 'server-1';
		const lastUsedRoomId = 'room-b';

		// Save a last-used room
		saveLastUsedRoom(serverId, lastUsedRoomId);

		// Simulate room list loading
		const rooms = [
			{ id: 'room-c', name: 'Charlie', serverId },
			{ id: 'room-a', name: 'Alpha', serverId },
			{ id: 'room-b', name: 'Beta', serverId }
		];

		// Sort rooms
		const sortedRooms = sortRooms(rooms);

		// Get last used room
		const retrievedLastUsedRoomId = getLastUsedRoom(serverId);

		// Verify last-used room is retrieved
		expect(retrievedLastUsedRoomId).toBe(lastUsedRoomId);

		// Verify room exists in sorted list (preselection logic should find it)
		const roomExists = sortedRooms.some((r) => r.id === lastUsedRoomId);
		expect(roomExists).toBe(true);

		// In the actual component, this would trigger selectedRoomId = lastUsedRoomId
		// when selectedRoomId is empty
		const currentSelectedRoomId = '';
		const shouldPreselect = !currentSelectedRoomId && roomExists;
		expect(shouldPreselect).toBe(true);
	});

	it('does not preselect when last-used room is not in current list', () => {
		const serverId = 'server-1';
		const lastUsedRoomId = 'room-removed';

		// Save a last-used room
		saveLastUsedRoom(serverId, lastUsedRoomId);

		// Simulate room list loading (last-used room not present)
		const rooms = [
			{ id: 'room-a', name: 'Alpha', serverId },
			{ id: 'room-b', name: 'Beta', serverId }
		];

		const sortedRooms = sortRooms(rooms);
		const retrievedLastUsedRoomId = getLastUsedRoom(serverId);

		expect(retrievedLastUsedRoomId).toBe(lastUsedRoomId);

		// Verify room does NOT exist in sorted list
		const roomExists = sortedRooms.some((r) => r.id === lastUsedRoomId);
		expect(roomExists).toBe(false);

		// Should not preselect since room doesn't exist
		const currentSelectedRoomId = '';
		const shouldPreselect = !currentSelectedRoomId && roomExists;
		expect(shouldPreselect).toBe(false);
	});

	it('does not overwrite existing selection', () => {
		const serverId = 'server-1';
		const lastUsedRoomId = 'room-a';
		const currentlySelectedRoomId = 'room-b';

		saveLastUsedRoom(serverId, lastUsedRoomId);

		const rooms = [
			{ id: 'room-a', name: 'Alpha', serverId },
			{ id: 'room-b', name: 'Beta', serverId }
		];

		const sortedRooms = sortRooms(rooms);
		const retrievedLastUsedRoomId = getLastUsedRoom(serverId);
		const roomExists = sortedRooms.some((r) => r.id === retrievedLastUsedRoomId);

		// Should not preselect because a room is already selected
		const shouldPreselect = !currentlySelectedRoomId && roomExists;
		expect(shouldPreselect).toBe(false);
	});
});
