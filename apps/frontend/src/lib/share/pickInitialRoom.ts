/**
 * Decide whether to preselect the last-used room.
 * Returns the room ID to select, or null if no preselection should occur.
 *
 * @param currentSelected - The currently selected room ID (empty string if none)
 * @param lastUsedId - The last-used room ID for this server (null if none)
 * @param availableRoomIds - List of room IDs currently in the list
 * @returns The room ID to preselect, or null
 */
export function pickInitialRoom(
  currentSelected: string,
  lastUsedId: string | null,
  availableRoomIds: readonly string[]
): string | null {
  // Don't preselect if a room is already selected
  if (currentSelected) {
    return null;
  }

  // Don't preselect if no last-used room
  if (!lastUsedId) {
    return null;
  }

  // Only preselect if the last-used room exists in the current list
  if (availableRoomIds.includes(lastUsedId)) {
    return lastUsedId;
  }

  return null;
}
