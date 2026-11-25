/**
 * Sort rooms alphabetically by display name with stable tiebreak on room ID.
 * Uses case-insensitive, locale-aware comparison.
 */

export interface RoomForSort {
	id: string;
	name: string;
}

export function sortRooms<T extends RoomForSort>(rooms: readonly T[]): T[] {
	// Create a shallow copy to avoid mutating the input array
	return [...rooms].sort((a, b) => {
		// Case-insensitive, locale-aware comparison with 'base' sensitivity
		const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
		if (nameCompare !== 0) return nameCompare;
		
		// Stable tiebreak on room ID
		return a.id.localeCompare(b.id);
	});
}
