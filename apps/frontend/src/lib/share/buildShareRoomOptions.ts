import { RoomKind } from '@chatto/client/api/roomDirectory';
import type { RoomsListItem } from '$lib/state/server/navigation';
import { buildDirectMessagePresentation } from '@chatto/client/timeline/users';
import { isNavigationVisibleRoom } from '$lib/state/server/navigation';
import type { DirectMessageLabels } from '@chatto/client/timeline/users';

export interface ShareRoomOption {
  id: string;
  name: string;
  serverId: string;
  isDM: boolean;
  sortKey: string;
}

/**
 * Build share room options from raw room list:
 * - Labels DMs using buildDirectMessagePresentation with @ prefix
 * - Filters to only rooms user can post in (member of, not empty DM)
 * - Sorts channels A-Z first, then DMs A-Z
 */
export function buildShareRoomOptions(
  rooms: readonly RoomsListItem[],
  serverId: string,
  currentUserId: string | null,
  dmLabels: DirectMessageLabels
): ShareRoomOption[] {
  const options: ShareRoomOption[] = [];

  for (const room of rooms) {
    // Filter: only show rooms that are navigation-visible (not empty DMs)
    if (!isNavigationVisibleRoom(room)) {
      continue;
    }

    // Filter: only show rooms user is a member of (can post in)
    if (room.viewerIsMember !== true) {
      continue;
    }

    const isDM = room.type === RoomKind.DM;

    let displayName: string;
    if (isDM) {
      // Use buildDirectMessagePresentation for DMs
      const presentation = buildDirectMessagePresentation(room.members, currentUserId, dmLabels);
      // Add @ prefix to distinguish DMs in a plain select dropdown
      displayName = `@ ${presentation.label}`;
    } else {
      // Channels use their name as-is
      displayName = room.name;
    }

    // Sort key: channels first (prefix "0:"), then DMs (prefix "1:")
    // Both sorted alphabetically within their group
    const sortKey = `${isDM ? '1' : '0'}:${displayName.toLowerCase()}`;

    options.push({
      id: room.id,
      name: displayName,
      serverId,
      isDM,
      sortKey
    });
  }

  // Sort by sortKey (channels A-Z, then DMs A-Z)
  return options.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}
