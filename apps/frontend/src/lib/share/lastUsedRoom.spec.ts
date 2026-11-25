import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastUsedRoom, saveLastUsedRoom } from './lastUsedRoom';

describe('lastUsedRoom', () => {
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

	it('saves and retrieves last used room for a server', () => {
		const serverId = 'server-123';
		const roomId = 'room-456';

		saveLastUsedRoom(serverId, roomId);
		const retrieved = getLastUsedRoom(serverId);

		expect(retrieved).toBe(roomId);
	});

	it('returns null when no room has been saved for a server', () => {
		const retrieved = getLastUsedRoom('nonexistent-server');
		expect(retrieved).toBeNull();
	});

	it('stores rooms separately per server', () => {
		saveLastUsedRoom('server-1', 'room-a');
		saveLastUsedRoom('server-2', 'room-b');

		expect(getLastUsedRoom('server-1')).toBe('room-a');
		expect(getLastUsedRoom('server-2')).toBe('room-b');
	});

	it('overwrites previous room for same server', () => {
		const serverId = 'server-123';
		
		saveLastUsedRoom(serverId, 'room-old');
		expect(getLastUsedRoom(serverId)).toBe('room-old');

		saveLastUsedRoom(serverId, 'room-new');
		expect(getLastUsedRoom(serverId)).toBe('room-new');
	});

	it('handles localStorage unavailable (SSR)', () => {
		Object.defineProperty(global, 'localStorage', {
			value: undefined,
			writable: true,
			configurable: true
		});

		// Should not throw
		expect(() => saveLastUsedRoom('server-1', 'room-1')).not.toThrow();
		expect(getLastUsedRoom('server-1')).toBeNull();
	});

	it('handles localStorage errors (private mode)', () => {
		const mockLocalStorage = {
			getItem: vi.fn(() => {
				throw new Error('QuotaExceededError');
			}),
			setItem: vi.fn(() => {
				throw new Error('QuotaExceededError');
			})
		};

		Object.defineProperty(global, 'localStorage', {
			value: mockLocalStorage,
			writable: true,
			configurable: true
		});

		// Should not throw
		expect(() => saveLastUsedRoom('server-1', 'room-1')).not.toThrow();
		expect(getLastUsedRoom('server-1')).toBeNull();
	});

	it('uses namespaced storage keys', () => {
		const serverId = 'my-server';
		const roomId = 'my-room';

		saveLastUsedRoom(serverId, roomId);

		expect(global.localStorage.setItem).toHaveBeenCalledWith(
			'chatto:share:lastRoom:my-server',
			'my-room'
		);
	});
});
