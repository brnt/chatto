/**
 * Module-level stash for share data to avoid double-fetching single-use shares.
 *
 * The share page fetches share data from /api/share/:id (which deletes it on read).
 * Before navigating to the room, it stashes the data here. The ConversationPane
 * takes it without refetching. This prevents 404s from the second read.
 */

export type ShareData = {
  id: string;
  title?: string;
  text?: string;
  url?: string;
  files?: Array<{
    filename: string;
    contentType: string;
    data: string; // base64
    size: number;
  }>;
};

const pendingShares = new Map<string, ShareData>();

/**
 * Stash share data before navigation. Call this in the share picker before goto.
 */
export function stashShare(data: ShareData): void {
  pendingShares.set(data.id, data);
}

/**
 * Take share data, removing it from the stash. Returns undefined if not found.
 * Call this in ConversationPane before fetching.
 */
export function takeShare(id: string): ShareData | undefined {
  const data = pendingShares.get(id);
  if (data) {
    pendingShares.delete(id);
  }
  return data;
}
