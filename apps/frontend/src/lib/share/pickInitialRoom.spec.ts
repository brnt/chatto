import { describe, expect, it } from 'vitest';
import { pickInitialRoom } from './pickInitialRoom';

describe('pickInitialRoom', () => {
	it('returns last-used room when no room selected and room exists', () => {
		const result = pickInitialRoom('', 'room-a', ['room-a', 'room-b', 'room-c']);
		expect(result).toBe('room-a');
	});

	it('returns null when a room is already selected', () => {
		const result = pickInitialRoom('room-b', 'room-a', ['room-a', 'room-b', 'room-c']);
		expect(result).toBeNull();
	});

	it('returns null when no last-used room', () => {
		const result = pickInitialRoom('', null, ['room-a', 'room-b', 'room-c']);
		expect(result).toBeNull();
	});

	it('returns null when last-used room not in available list', () => {
		const result = pickInitialRoom('', 'room-removed', ['room-a', 'room-b', 'room-c']);
		expect(result).toBeNull();
	});

	it('handles empty available rooms list', () => {
		const result = pickInitialRoom('', 'room-a', []);
		expect(result).toBeNull();
	});

	it('returns last-used room when it is the only available room', () => {
		const result = pickInitialRoom('', 'room-a', ['room-a']);
		expect(result).toBe('room-a');
	});
});
