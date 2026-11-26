import { describe, expect, it } from 'vitest';
import { buildShareRoomOptions } from './buildShareRoomOptions';
import { RoomKind } from '@chatto/client/api/roomDirectory';
import type { RoomsListItem } from '$lib/state/server/navigation';
import type { DirectMessageLabels } from '@chatto/client/timeline/users';

const mockDMLabels: DirectMessageLabels = {
  currentUser: 'you',
  deletedUser: 'Deleted User'
};

function createRoom(overrides: Partial<RoomsListItem>): RoomsListItem {
  return {
    id: 'room-1',
    name: 'General',
    type: RoomKind.CHANNEL,
    viewerIsMember: true,
    hasMessageHistory: true,
    members: [],
    viewerNotificationCount: 0,
    viewerImportantNotificationCount: 0,
    ...overrides
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as RoomsListItem;
}

describe('buildShareRoomOptions', () => {
  it('labels empty-name DM with other member name and @ prefix', () => {
    const rooms = [
      createRoom({
        id: 'dm-1',
        name: '', // Empty name as reported by backend for DMs
        type: RoomKind.DM,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-2', displayName: 'Bob', login: 'bob' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('@ Bob');
    expect(result[0].isDM).toBe(true);
  });

  it('filters out empty DMs (no message history)', () => {
    const rooms = [
      createRoom({
        id: 'dm-empty',
        type: RoomKind.DM,
        hasMessageHistory: false,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-2', displayName: 'Bob', login: 'bob' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      }),
      createRoom({
        id: 'dm-with-history',
        type: RoomKind.DM,
        hasMessageHistory: true,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-3', displayName: 'Charlie', login: 'charlie' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dm-with-history');
  });

  it('filters out channels where user is not a member', () => {
    const rooms = [
      createRoom({
        id: 'channel-member',
        name: 'Team',
        viewerIsMember: true
      }),
      createRoom({
        id: 'channel-not-member',
        name: 'Private',
        viewerIsMember: false
      }),
      createRoom({
        id: 'channel-undefined',
        name: 'Unknown',
        viewerIsMember: undefined
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('channel-member');
  });

  it('sorts channels before DMs', () => {
    const rooms = [
      createRoom({
        id: 'dm-1',
        name: '',
        type: RoomKind.DM,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-2', displayName: 'Bob', login: 'bob' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      }),
      createRoom({
        id: 'channel-1',
        name: 'Zebra'
      }),
      createRoom({
        id: 'channel-2',
        name: 'Alpha'
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toHaveLength(3);
    // Channels first
    expect(result[0].id).toBe('channel-2');
    expect(result[0].name).toBe('Alpha');
    expect(result[0].isDM).toBe(false);
    expect(result[1].id).toBe('channel-1');
    expect(result[1].name).toBe('Zebra');
    expect(result[1].isDM).toBe(false);
    // Then DMs
    expect(result[2].id).toBe('dm-1');
    expect(result[2].name).toBe('@ Bob');
    expect(result[2].isDM).toBe(true);
  });

  it('sorts DMs alphabetically by label', () => {
    const rooms = [
      createRoom({
        id: 'dm-3',
        name: '',
        type: RoomKind.DM,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-zebra', displayName: 'Zebra', login: 'zebra' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      }),
      createRoom({
        id: 'dm-2',
        name: '',
        type: RoomKind.DM,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-charlie', displayName: 'Charlie', login: 'charlie' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      }),
      createRoom({
        id: 'dm-1',
        name: '',
        type: RoomKind.DM,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-bob', displayName: 'Bob', login: 'bob' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('@ Bob');
    expect(result[1].name).toBe('@ Charlie');
    expect(result[2].name).toBe('@ Zebra');
  });

  it('handles self-DM correctly', () => {
    const rooms = [
      createRoom({
        id: 'dm-self',
        name: '',
        type: RoomKind.DM,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toHaveLength(1);
    // Self-DM shows own name with "(you)" suffix
    expect(result[0].name).toBe('@ Alice (you)');
    expect(result[0].isDM).toBe(true);
  });

  it('filters out last-used room if it is now filtered (not a member)', () => {
    const rooms = [
      createRoom({
        id: 'channel-available',
        name: 'Public',
        viewerIsMember: true
      }),
      createRoom({
        id: 'channel-last-used',
        name: 'Private',
        viewerIsMember: false // User removed from room
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    // Last-used room should not be in results
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('channel-available');
    expect(result.find((r) => r.id === 'channel-last-used')).toBeUndefined();
  });

  it('includes channels with names as-is (no prefix)', () => {
    const rooms = [
      createRoom({
        id: 'channel-1',
        name: 'general',
        type: RoomKind.CHANNEL
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('general');
    expect(result[0].isDM).toBe(false);
  });

  it('preserves serverId in all options', () => {
    const rooms = [
      createRoom({
        id: 'channel-1',
        name: 'general'
      }),
      createRoom({
        id: 'dm-1',
        name: '',
        type: RoomKind.DM,
        members: [
          { id: 'user-1', displayName: 'Alice', login: 'alice' },
          { id: 'user-2', displayName: 'Bob', login: 'bob' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-123', 'user-1', mockDMLabels);

    expect(result).toHaveLength(2);
    expect(result[0].serverId).toBe('server-123');
    expect(result[1].serverId).toBe('server-123');
  });

  it('returns empty array when all rooms are filtered out', () => {
    const rooms = [
      createRoom({
        id: 'channel-1',
        name: 'Private',
        viewerIsMember: false
      }),
      createRoom({
        id: 'dm-1',
        name: '',
        type: RoomKind.DM,
        hasMessageHistory: false,
        members: []
      })
    ];

    const result = buildShareRoomOptions(rooms, 'server-1', 'user-1', mockDMLabels);

    expect(result).toEqual([]);
  });
});
