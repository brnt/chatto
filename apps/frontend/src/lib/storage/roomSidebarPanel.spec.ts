import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY,
  getDesktopRoomSidebarPanelPreference,
  setDesktopRoomSidebarPanelPreference
} from './roomSidebarPanel';

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('desktop room sidebar panel storage', () => {
  it('distinguishes no choice from closed', () => {
    expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();
  });

  it('persists the selected panel globally', () => {
    setDesktopRoomSidebarPanelPreference('files');
    expect(getDesktopRoomSidebarPanelPreference()).toBe('files');
    expect(localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)).toBe('files');

    setDesktopRoomSidebarPanelPreference('search');
    expect(getDesktopRoomSidebarPanelPreference()).toBe('search');
  });

  it('retains closed state across reloads', () => {
    setDesktopRoomSidebarPanelPreference('files');
    setDesktopRoomSidebarPanelPreference(null);

    expect(localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)).toBe('closed');
    expect(getDesktopRoomSidebarPanelPreference()).toBeNull();
  });

  it('stores only the underlying panel for a profile preference', () => {
    setDesktopRoomSidebarPanelPreference({ previousPanel: 'files' });
    expect(localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)).toBe('files');
    expect(getDesktopRoomSidebarPanelPreference()).toBe('files');

    setDesktopRoomSidebarPanelPreference({ previousPanel: null });
    expect(localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)).toBe('closed');
    expect(getDesktopRoomSidebarPanelPreference()).toBeNull();
  });

  it('handles missing local storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();
    expect(() => setDesktopRoomSidebarPanelPreference('files')).not.toThrow();
  });

  it('handles storage access and quota failures', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage access denied');
      },
      setItem: () => {
        throw new Error('Storage full');
      }
    });
    expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();
    expect(() => setDesktopRoomSidebarPanelPreference('files')).not.toThrow();
  });

  it.each(['calendar', 'profile:files', 'profile:', 'profile:unknown', '{', 'null'])(
    'treats unknown or legacy stored values as no choice: %s',
    (raw) => {
      localStorage.setItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY, raw);
      expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();
    }
  );
});
