import type { Codec } from '@chatto/client/storage/slot';

export const ROOM_SIDEBAR_PANELS = ['members', 'search', 'files', 'pins', 'call'] as const;

export type RoomSidebarPanel = (typeof ROOM_SIDEBAR_PANELS)[number];
export type RoomSidebarPanelState = RoomSidebarPanel | null;

/** Durable sentinel for an explicit desktop choice to hide the room sidebar. */
export const DESKTOP_ROOM_SIDEBAR_CLOSED = 'closed' as const;
export type DesktopRoomSidebarClosed = typeof DESKTOP_ROOM_SIDEBAR_CLOSED;

/**
 * Durable desktop preference values. `'closed'` is intentional hide; a missing
 * key (undefined from get) means no choice yet and room defaults may apply.
 */
export type DurableDesktopRoomSidebarPanel = RoomSidebarPanel | DesktopRoomSidebarClosed;

/** A desktop profile retains the extras panel to show when the profile closes. */
export type RoomSidebarProfilePreference = {
  previousPanel: RoomSidebarPanelState;
};

/**
 * In-memory desktop preference. Undefined means no saved choice. The durable
 * closed sentinel is never stored as null — null is only the derived display
 * state for a hidden sidebar.
 */
export type RoomSidebarPreference =
  DurableDesktopRoomSidebarPanel | RoomSidebarProfilePreference | undefined;

/** Durable localStorage key for the last desktop room-sidebar mode. */
export const DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY = 'chatto:roomSidebarPanel';

function isRoomSidebarPanel(value: unknown): value is RoomSidebarPanel {
  return typeof value === 'string' && ROOM_SIDEBAR_PANELS.includes(value as RoomSidebarPanel);
}

function isDurableDesktopRoomSidebarPanel(value: unknown): value is DurableDesktopRoomSidebarPanel {
  return value === DESKTOP_ROOM_SIDEBAR_CLOSED || isRoomSidebarPanel(value);
}

// Keep this startup codec small: the root app UI also loads on the login page.
const durableCodec: Codec<DurableDesktopRoomSidebarPanel> = {
  serialize: (value) => value,
  parse: (raw) => {
    if (isDurableDesktopRoomSidebarPanel(raw)) return raw;
    // Ignore legacy profile encodings, bare null, and unknown values.
    return undefined;
  }
};

function durablePanelFromPreference(
  panel: Exclude<RoomSidebarPreference, undefined>
): DurableDesktopRoomSidebarPanel {
  if (typeof panel === 'object' && panel !== null) {
    return panel.previousPanel === null ? DESKTOP_ROOM_SIDEBAR_CLOSED : panel.previousPanel;
  }
  return panel;
}

/** Read the durable desktop choice without applying a room-specific default. */
export function getDesktopRoomSidebarPanelPreference(): DurableDesktopRoomSidebarPanel | undefined {
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
  panel: Exclude<RoomSidebarPreference, undefined> | null
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const durable =
      panel === null ? DESKTOP_ROOM_SIDEBAR_CLOSED : durablePanelFromPreference(panel);
    localStorage.setItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY, durableCodec.serialize(durable));
  } catch {
    // The app UI retains the choice in memory when storage is unavailable or full.
  }
}

/** Map a durable preference to the panel shown in the room layout. */
export function roomSidebarPanelFromDurable(
  preference: DurableDesktopRoomSidebarPanel
): RoomSidebarPanelState {
  return preference === DESKTOP_ROOM_SIDEBAR_CLOSED ? null : preference;
}
