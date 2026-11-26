import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUiState } from './appUi.svelte';

import {
  DESKTOP_ROOM_SIDEBAR_CLOSED,
  DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY,
  getDesktopRoomSidebarPanelPreference,
  setDesktopRoomSidebarPanelPreference
} from '$lib/storage/roomSidebarPanel';

describe('AppUiState', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('requests only visible Members on navigation, panel actions, and viewport changes', () => {
    let desktop = false;
    vi.spyOn(window, 'matchMedia').mockImplementation(
      () => ({ matches: desktop }) as MediaQueryList
    );
    const request = vi.fn();
    const appUi = new AppUiState(request);
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.loadVisibleRoomMembers();
    appUi.openMobileRoomSidebarPanel('files');
    expect(request).not.toHaveBeenCalled();
    appUi.openMobileRoomSidebarPanel('members');
    expect(request).toHaveBeenLastCalledWith({ serverId: 'server-a', roomId: 'room-1' });
    request.mockClear();
    appUi.closeMobileRoomSidebarPanel();
    desktop = true;
    appUi.loadVisibleRoomMembers();
    expect(request).toHaveBeenCalledOnce();
    request.mockClear();
    appUi.closeDesktopRoomSidebarPanel();
    appUi.loadVisibleRoomMembers();
    appUi.openDesktopRoomSidebarPanel('files');
    appUi.loadVisibleRoomMembers();
    expect(request).not.toHaveBeenCalled();
    appUi.openDesktopRoomSidebarPanel('members');
    expect(request).toHaveBeenCalledOnce();
    request.mockClear();
    appUi.openMemberProfile('peer', 'desktop');
    appUi.loadVisibleRoomMembers();
    expect(request).not.toHaveBeenCalled();
    appUi.backToRoomMembers('desktop');
    expect(request).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('tracks the active chat route scope', () => {
    const appUi = new AppUiState();

    expect(appUi.activeRoomScope).toBe(null);

    appUi.setActiveRoomScope('server-a', 'room-1');

    expect(appUi.activeRoomScope).toEqual({ serverId: 'server-a', roomId: 'room-1' });
  });

  it('clears room scope when the active route moves to a server page', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.setRoomCallWide('server-a', 'room-1', true);
    appUi.setActiveServer('server-a');

    expect(appUi.activeRoomScope).toBe(null);
    expect(appUi.isRoomCallWide).toBe(false);
  });

  it('resolves room defaults without saving a choice or opening mobile panes', () => {
    const appUi = new AppUiState();
    expect(appUi.desktopRoomSidebarPanel('members')).toBeNull();
    appUi.setActiveRoomScope('server-a', 'room-1');
    expect(appUi.desktopRoomSidebarPanel('members')).toBe('members');
    expect(appUi.mobileRoomSidebarPanel).toBeNull();
    expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();
    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.desktopRoomSidebarPanel(null)).toBeNull();
    expect(appUi.desktopRoomSidebarProfileUserId('peer')).toBe('peer');
  });

  it('closes default Members on the first toggle and restores that choice after reload', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.toggleDesktopRoomSidebarPanel('members', 'members');
    expect(appUi.desktopRoomSidebarPanel('members')).toBeNull();
    const restored = new AppUiState();
    restored.setActiveRoomScope('server-a', 'room-1');
    expect(restored.desktopRoomSidebarPanel('members')).toBeNull();
    restored.setActiveRoomScope('server-b', 'room-1');
    expect(restored.desktopRoomSidebarPanel('members')).toBeNull();
    restored.toggleDesktopRoomSidebarPanel('members', 'members');
    expect(restored.desktopRoomSidebarPanel('members')).toBe('members');
  });

  it('retains choices across page sessions in local storage', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.closeDesktopRoomSidebarPanel();
    appUi.setActiveRoomScope('server-a', 'dm-1');
    appUi.openDesktopRoomSidebarPanel('files');

    const restored = new AppUiState();
    restored.setActiveRoomScope('server-a', 'room-1');
    expect(restored.desktopRoomSidebarPanel('members')).toBe('files');
    restored.setActiveRoomScope('server-a', 'dm-1');
    expect(restored.desktopRoomSidebarPanel(null)).toBe('files');
    expect(restored.desktopRoomSidebarProfileUserId('peer')).toBeNull();
  });

  it('falls back to room defaults when local storage is cleared', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.closeDesktopRoomSidebarPanel();
    appUi.openDesktopRoomSidebarPanel('files');
    localStorage.clear();
    const fresh = new AppUiState();
    fresh.setActiveRoomScope('server-a', 'room-1');
    expect(fresh.desktopRoomSidebarPanel('members')).toBe('members');
    fresh.setActiveRoomScope('server-a', 'dm-1');
    expect(fresh.desktopRoomSidebarPanel(null)).toBeNull();
    expect(fresh.desktopRoomSidebarProfileUserId('peer')).toBe('peer');
  });

  it('retains choices during navigation when local storage is unavailable', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    try {
      const appUi = new AppUiState();
      appUi.setActiveRoomScope('server-a', 'room-1');
      appUi.openDesktopRoomSidebarPanel('files');
      appUi.setActiveRoomScope('server-a', 'room-2');
      appUi.setActiveRoomScope('server-a', 'room-1');
      expect(appUi.desktopRoomSidebarPanel('members')).toBe('files');
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it('remembers explicit desktop sidebar state globally across rooms', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openDesktopRoomSidebarPanel('files');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');
    expect(getDesktopRoomSidebarPanelPreference()).toBe('files');

    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');

    appUi.openDesktopRoomSidebarPanel('members');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('members');

    appUi.setActiveRoomScope('server-a', 'room-1');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('members');

    appUi.closeDesktopRoomSidebarPanel();
    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe(null);
    expect(getDesktopRoomSidebarPanelPreference()).toBe(DESKTOP_ROOM_SIDEBAR_CLOSED);
  });

  it('scopes mobile room sidebar state to the active room', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openMobileRoomSidebarPanel('files');

    expect(appUi.mobileRoomSidebarPanel).toBe('files');

    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.mobileRoomSidebarPanel).toBe(null);
  });

  it('shows a profile without replacing the selected desktop extras panel', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openDesktopRoomSidebarPanel('files');
    appUi.openRoomSidebarProfile('user-1');

    expect(appUi.activeRoomSidebarProfileUserId).toBe('user-1');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');

    appUi.closeRoomSidebarProfile();

    expect(appUi.activeRoomSidebarProfileUserId).toBe(null);
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');
  });

  it('shows the requested extras panel when a profile is open', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openDesktopRoomSidebarPanel('files');
    appUi.openRoomSidebarProfile('user-1');
    appUi.toggleDesktopRoomSidebarPanel('files');

    expect(appUi.activeRoomSidebarProfileUserId).toBe(null);
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');
  });

  it('opens a temporary Members profile without persisting its user', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openDesktopRoomSidebarPanel('files');
    appUi.openMemberProfile('user-1', 'desktop');
    expect(appUi.activeRoomScope).toEqual({ serverId: 'server-a', roomId: 'room-1' });
    expect(appUi.activeRoomSidebarProfileUserId).toBe('user-1');
    expect(appUi.isMemberProfileOpen).toBe(true);
    expect(getDesktopRoomSidebarPanelPreference()).toBe('members');

    appUi.openMemberProfile('user-2', 'desktop');
    expect(appUi.activeRoomSidebarProfileUserId).toBe('user-2');
    appUi.backToRoomMembers('desktop');
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('members');

    const restored = new AppUiState();
    restored.setActiveRoomScope('server-a', 'room-1');
    expect(restored.activeRoomSidebarProfileUserId).toBeNull();
    expect(restored.activeDesktopRoomSidebarPanel).toBe('members');
  });

  it('returns to Members after a breakpoint change without changing desktop preferences on mobile', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openDesktopRoomSidebarPanel('files');
    appUi.openMemberProfile('user-1', 'mobile');
    appUi.backToRoomMembers('mobile');
    expect(appUi.mobileRoomSidebarPanel).toBe('members');
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();
    expect(getDesktopRoomSidebarPanelPreference()).toBe('files');

    appUi.openMemberProfile('user-1', 'desktop');
    appUi.backToRoomMembers('mobile');
    expect(appUi.mobileRoomSidebarPanel).toBe('members');
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();

    appUi.openMemberProfile('user-1', 'mobile');
    appUi.backToRoomMembers('desktop');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('members');
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();
  });

  it('discards a Members profile when the room or server changes', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openMemberProfile('user-1', 'desktop');
    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.isMemberProfileOpen).toBe(false);
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();
    appUi.openMemberProfile('user-2', 'desktop');
    appUi.setActiveServer('server-b');
    expect(appUi.isMemberProfileOpen).toBe(false);
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();
  });

  it('clears transient room-sidebar profiles when the viewer changes rooms', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openRoomSidebarProfile('user-1');
    appUi.setActiveRoomScope('server-a', 'room-2');

    expect(appUi.activeRoomSidebarProfileUserId).toBe(null);
  });

  it('applies a desktop sidebar request when its room becomes active', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.requestRoomSidebarPanel('server-a', 'room-2', 'call', 'desktop');

    expect(appUi.activeDesktopRoomSidebarPanel).toBe(null);

    appUi.setActiveRoomScope('server-a', 'room-2');

    expect(appUi.activeDesktopRoomSidebarPanel).toBe('call');
    expect(getDesktopRoomSidebarPanelPreference()).toBe('call');
  });

  it('applies a mobile sidebar request once', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.requestRoomSidebarPanel('server-a', 'room-2', 'files', 'mobile');
    appUi.setActiveRoomScope('server-a', 'room-2');

    expect(appUi.mobileRoomSidebarPanel).toBe('files');
    expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();

    appUi.closeMobileRoomSidebarPanel();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.setActiveRoomScope('server-a', 'room-2');

    expect(appUi.mobileRoomSidebarPanel).toBe(null);
  });

  it('applies a sidebar request immediately for the active room', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.requestRoomSidebarPanel('server-a', 'room-1', 'files', 'desktop');

    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');
  });

  it('applies a pending profile request after direct-message navigation', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.requestRoomSidebarProfile('server-a', 'dm-1', 'user-1');

    expect(appUi.activeRoomSidebarProfileUserId).toBe(null);

    appUi.setActiveRoomScope('server-a', 'dm-1');

    expect(appUi.activeRoomSidebarProfileUserId).toBe('user-1');
  });

  it('restores desktop panels and closed state in a new app instance', () => {
    const first = new AppUiState();
    first.setActiveRoomScope('server-a', 'room-1');
    first.openDesktopRoomSidebarPanel('search');
    const restored = new AppUiState();
    restored.setActiveRoomScope('server-a', 'room-1');
    expect(restored.activeDesktopRoomSidebarPanel).toBe('search');
    restored.closeDesktopRoomSidebarPanel();
    const closed = new AppUiState();
    closed.setActiveRoomScope('server-a', 'room-1');
    expect(closed.desktopRoomSidebarProfileUserId('peer')).toBeNull();
    expect(closed.activeDesktopRoomSidebarPanel).toBeNull();
  });

  it('cold start: honors stored closed on first desktop room mount', () => {
    localStorage.setItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY, DESKTOP_ROOM_SIDEBAR_CLOSED);
    expect(getDesktopRoomSidebarPanelPreference()).toBe(DESKTOP_ROOM_SIDEBAR_CLOSED);
    expect(Boolean(getDesktopRoomSidebarPanelPreference())).toBe(true);

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    // Channel default must not replace an explicit closed choice.
    expect(appUi.desktopRoomSidebarPanel('members')).toBeNull();
    expect(appUi.activeDesktopRoomSidebarPanel).toBeNull();
    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.desktopRoomSidebarPanel('members')).toBeNull();
    expect(localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)).toBe(
      DESKTOP_ROOM_SIDEBAR_CLOSED
    );
    expect(
      setItem.mock.calls.filter(([key]) => key === DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)
    ).toEqual([]);
  });

  it('persists closed even after the active room scope is cleared', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openDesktopRoomSidebarPanel('files');
    appUi.setActiveServer('server-a');
    appUi.closeDesktopRoomSidebarPanel();
    expect(getDesktopRoomSidebarPanelPreference()).toBe(DESKTOP_ROOM_SIDEBAR_CLOSED);

    const restored = new AppUiState();
    restored.setActiveRoomScope('server-a', 'room-1');
    expect(restored.desktopRoomSidebarPanel('members')).toBeNull();
  });

  it('derives a default profile only until an explicit choice is made', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'dm-1');
    expect(appUi.desktopRoomSidebarProfileUserId(null)).toBeNull();
    expect(appUi.desktopRoomSidebarProfileUserId('peer')).toBe('peer');
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();
    expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();
    appUi.closeRoomSidebarProfile('desktop');
    expect(appUi.desktopRoomSidebarProfileUserId('peer')).toBeNull();
    appUi.setActiveRoomScope('server-a', 'dm-2');
    expect(appUi.desktopRoomSidebarProfileUserId('other-peer')).toBeNull();
  });

  it('restores the underlying panel after a profile without reopening the profile', () => {
    const first = new AppUiState();
    first.setActiveRoomScope('server-a', 'dm-1');
    first.openDesktopRoomSidebarPanel('files');
    first.openRoomSidebarProfile('peer', 'desktop');
    expect(getDesktopRoomSidebarPanelPreference()).toBe('files');

    const restored = new AppUiState();
    restored.setActiveRoomScope('server-a', 'dm-1');
    expect(restored.desktopRoomSidebarProfileUserId('peer')).toBeNull();
    expect(restored.activeRoomSidebarProfileUserId).toBeNull();
    expect(restored.mobileRoomSidebarPanel).toBeNull();
    expect(restored.activeDesktopRoomSidebarPanel).toBe('files');
  });

  it('selects the underlying panel when toggled from an open profile', () => {
    setDesktopRoomSidebarPanelPreference('files');
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'dm-1');
    appUi.openRoomSidebarProfile('peer', 'desktop');
    appUi.toggleDesktopRoomSidebarPanel('files');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');
    expect(appUi.desktopRoomSidebarProfileUserId('peer')).toBeNull();
  });

  it('applies explicit navigation requests after restoring the saved preference', () => {
    setDesktopRoomSidebarPanelPreference('files');
    const appUi = new AppUiState();
    appUi.requestRoomSidebarPanel('server-a', 'dm-1', 'call', 'desktop');
    appUi.setActiveRoomScope('server-a', 'dm-1');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('call');
    expect(appUi.desktopRoomSidebarProfileUserId('peer')).toBeNull();
  });

  it('selects the underlying mobile panel when a profile is open', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'dm-1');
    appUi.openMobileRoomSidebarPanel('files');
    appUi.openRoomSidebarProfile('peer', 'mobile');
    appUi.toggleMobileRoomSidebarPanel('files');
    expect(appUi.activeRoomSidebarProfileUserId).toBeNull();
    expect(appUi.mobileRoomSidebarPanel).toBe('files');
    expect(getDesktopRoomSidebarPanelPreference()).toBeUndefined();
  });

  it('keeps desktop preferences intact during mobile actions', () => {
    const appUi = new AppUiState();
    appUi.setActiveRoomScope('server-a', 'dm-1');
    appUi.openDesktopRoomSidebarPanel('files');
    appUi.openRoomSidebarProfile('peer', 'mobile');
    appUi.closeRoomSidebarProfile('mobile');
    appUi.requestRoomSidebarPanel('server-a', 'dm-1', 'call', 'mobile');
    appUi.closeMobileRoomSidebarPanel();
    expect(getDesktopRoomSidebarPanelPreference()).toBe('files');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');
  });

  it('tracks the scoped wide call room', () => {
    const appUi = new AppUiState();

    expect(appUi.isRoomCallWide).toBe(false);
    expect(appUi.isRoomCallWideFor('server-a', 'room-1')).toBe(false);

    appUi.setRoomCallWide('server-a', 'room-1', true);

    expect(appUi.isRoomCallWide).toBe(true);
    expect(appUi.roomCallWideScope).toEqual({ serverId: 'server-a', roomId: 'room-1' });
    expect(appUi.isRoomCallWideFor('server-a', 'room-1')).toBe(true);
    expect(appUi.isRoomCallWideFor('server-a', 'room-2')).toBe(false);
  });

  it('toggles and disables the active wide call scope', () => {
    const appUi = new AppUiState();

    appUi.toggleRoomCallWide('server-a', 'room-1');
    expect(appUi.isRoomCallWideFor('server-a', 'room-1')).toBe(true);

    appUi.disableRoomCallWideFor('server-a', 'room-2');
    expect(appUi.isRoomCallWideFor('server-a', 'room-1')).toBe(true);

    appUi.disableRoomCallWideFor('server-a', 'room-1');
    expect(appUi.isRoomCallWide).toBe(false);
  });

  it('clears wide mode when the viewed room scope changes', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.setRoomCallWide('server-a', 'room-1', true);
    appUi.setActiveRoomScope('server-a', 'room-1');
    expect(appUi.isRoomCallWideFor('server-a', 'room-1')).toBe(true);

    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.isRoomCallWide).toBe(false);
  });

  it('exposes generic fullscreen UI state for top-level consumers', () => {
    const appUi = new AppUiState();

    expect(appUi.hasFullscreenSurface).toBe(false);

    appUi.setFullscreenSurface({ surface: 'media-viewer', id: 'asset-1' });
    expect(appUi.hasFullscreenSurface).toBe(true);
    expect(appUi.fullscreenSurface).toEqual({ surface: 'media-viewer', id: 'asset-1' });

    appUi.clearFullscreenSurface();
    expect(appUi.fullscreenSurface).toBe(null);
  });
});
