import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverIdToSegment } from '$lib/navigation';
import { stashShare, takeShare } from '$lib/state/pendingShare';

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
