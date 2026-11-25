import { describe, expect, it } from 'vitest';
import { sortRooms } from './sortRooms';

describe('sortRooms', () => {
	it('sorts rooms alphabetically by name', () => {
		const rooms = [
			{ id: 'r3', name: 'Zebra' },
			{ id: 'r1', name: 'Alpha' },
			{ id: 'r2', name: 'Beta' }
		];

		const sorted = sortRooms(rooms);

		expect(sorted.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Zebra']);
	});

	it('sorts case-insensitively', () => {
		const rooms = [
			{ id: 'r1', name: 'zebra' },
			{ id: 'r2', name: 'ALPHA' },
			{ id: 'r3', name: 'Beta' }
		];

		const sorted = sortRooms(rooms);

		expect(sorted.map((r) => r.name)).toEqual(['ALPHA', 'Beta', 'zebra']);
	});

	it('uses room ID as stable tiebreak for identical names', () => {
		const rooms = [
			{ id: 'r3', name: 'General' },
			{ id: 'r1', name: 'General' },
			{ id: 'r2', name: 'General' }
		];

		const sorted = sortRooms(rooms);

		expect(sorted.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
	});

	it('preserves additional properties on room objects', () => {
		const rooms = [
			{ id: 'r2', name: 'Beta', serverId: 's1', extra: 'data2' },
			{ id: 'r1', name: 'Alpha', serverId: 's1', extra: 'data1' }
		];

		const sorted = sortRooms(rooms);

		expect(sorted[0]).toEqual({ id: 'r1', name: 'Alpha', serverId: 's1', extra: 'data1' });
		expect(sorted[1]).toEqual({ id: 'r2', name: 'Beta', serverId: 's1', extra: 'data2' });
	});

	it('does not mutate the input array', () => {
		const rooms = [
			{ id: 'r2', name: 'Beta' },
			{ id: 'r1', name: 'Alpha' }
		];

		const original = [...rooms];
		sortRooms(rooms);

		expect(rooms).toEqual(original);
	});

	it('handles empty array', () => {
		const sorted = sortRooms([]);
		expect(sorted).toEqual([]);
	});

	it('handles single room', () => {
		const rooms = [{ id: 'r1', name: 'Only Room' }];
		const sorted = sortRooms(rooms);
		expect(sorted).toEqual(rooms);
	});

	it('handles locale-aware comparison', () => {
		const rooms = [
			{ id: 'r1', name: 'Äpfel' },
			{ id: 'r2', name: 'Zebra' },
			{ id: 'r3', name: 'Apfel' }
		];

		const sorted = sortRooms(rooms);

		// With base sensitivity, Ä and A should be treated as equivalent in ordering
		// Both Apfel and Äpfel come before Zebra
		expect(sorted[0].name).toMatch(/[AÄ]pfel/);
		expect(sorted[1].name).toMatch(/[AÄ]pfel/);
		expect(sorted[2].name).toBe('Zebra');
	});
});
