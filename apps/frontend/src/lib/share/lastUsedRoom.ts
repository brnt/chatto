/**
 * Persist and retrieve the last room ID shared to, per server.
 * Guards against SSR and private mode localStorage failures.
 */

const STORAGE_KEY_PREFIX = 'chatto:share:lastRoom:';

export function saveLastUsedRoom(serverId: string, roomId: string): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(`${STORAGE_KEY_PREFIX}${serverId}`, roomId);
	} catch (error) {
		// Private mode or storage disabled - silently ignore
		console.debug('Failed to save last used room:', error);
	}
}

export function getLastUsedRoom(serverId: string): string | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		return localStorage.getItem(`${STORAGE_KEY_PREFIX}${serverId}`);
	} catch (error) {
		// Private mode or storage disabled - silently ignore
		console.debug('Failed to get last used room:', error);
		return null;
	}
}
