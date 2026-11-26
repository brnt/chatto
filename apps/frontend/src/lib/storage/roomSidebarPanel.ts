import type { Codec } from '@chatto/client/storage/slot';

export const ROOM_SIDEBAR_PANELS = ['members', 'search', 'files', 'pins', 'call'] as const;

export type RoomSidebarPanel = (typeof ROOM_SIDEBAR_PANELS)[number];
export type RoomSidebarPanelState = RoomSidebarPanel | null;

/** A desktop profile retains the extras panel to show when the profile closes. */
export type RoomSidebarProfilePreference = {
  previousPanel: RoomSidebarPanelState;
};

/**
 * In-memory desktop preference. Undefined means no saved choice; null means the
 * user closed the sidebar. A profile preference is transient and is never the
 * durable stored value.
 */
export type RoomSidebarPreference =
  RoomSidebarPanelState | RoomSidebarProfilePreference | undefined;

/** Durable localStorage key for the last desktop room-sidebar mode. */
export const DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY = 'chatto:roomSidebarPanel';

function isRoomSidebarPanel(value: unknown): value is RoomSidebarPanel {
  return typeof value === 'string' && ROOM_SIDEBAR_PANELS.includes(value as RoomSidebarPanel);
}

// Keep this startup codec small: the root app UI also loads on the login page.
const durableCodec: Codec<RoomSidebarPanelState> = {
  serialize: (value) => (value === null ? 'closed' : value),
  parse: (raw) => {
    if (isRoomSidebarPanel(raw)) return raw;
    if (raw === 'closed') return null;
    // Ignore legacy profile encodings and unknown values.
    return undefined;
  }
};

function durablePanelFromPreference(
  panel: Exclude<RoomSidebarPreference, undefined>
): RoomSidebarPanelState {
  return typeof panel === 'object' && panel !== null ? panel.previousPanel : panel;
}

/** Read the durable desktop choice without applying a room-specific default. */
export function getDesktopRoomSidebarPanelPreference(): RoomSidebarPanelState | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY);
    if (raw === null) return undefined;
    return durableCodec.parse(raw);
  } catch {
    // Use the room default when storage is unavailable, including during SSR.
    return undefined;
  }
}

/**
 * Save an explicit desktop choice, including closed state.
 * Profile overlays store only their underlying panel so a reload does not
 * reopen a room-specific profile target.
 */
export function setDesktopRoomSidebarPanelPreference(
  panel: Exclude<RoomSidebarPreference, undefined>
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY,
      durableCodec.serialize(durablePanelFromPreference(panel))
    );
  } catch {
    // The app UI retains the choice in memory when storage is unavailable or full.
  }
}
