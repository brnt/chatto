import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { AppUiState } from './appUi.svelte';
import {
  DESKTOP_ROOM_SIDEBAR_CLOSED,
  DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY,
  getDesktopRoomSidebarPanelPreference,
  setDesktopRoomSidebarPanelPreference
} from '$lib/storage/roomSidebarPanel';
import AppUiColdStartHarness from './AppUiColdStartHarness.svelte';

describe('AppUiState cold start harness', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('honors stored closed after first room mount at desktop width', async () => {
    setDesktopRoomSidebarPanelPreference(null);
    expect(localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)).toBe(
      DESKTOP_ROOM_SIDEBAR_CLOSED
    );
    expect(getDesktopRoomSidebarPanelPreference()).toBe(DESKTOP_ROOM_SIDEBAR_CLOSED);

    const appUi = new AppUiState();
    render(AppUiColdStartHarness, { appUi, defaultPanel: 'members' });

    await expect.element(page.getByTestId('panel-state')).toHaveTextContent('closed');
    expect(appUi.desktopRoomSidebarPanel('members')).toBeNull();
    expect(getDesktopRoomSidebarPanelPreference()).toBe(DESKTOP_ROOM_SIDEBAR_CLOSED);
    expect(localStorage.getItem(DESKTOP_ROOM_SIDEBAR_PANEL_STORAGE_KEY)).toBe(
      DESKTOP_ROOM_SIDEBAR_CLOSED
    );
  });

  it('honors stored files after first room mount', async () => {
    setDesktopRoomSidebarPanelPreference('files');
    const appUi = new AppUiState();
    render(AppUiColdStartHarness, { appUi, defaultPanel: 'members' });
    await expect.element(page.getByTestId('panel-state')).toHaveTextContent('files');
    expect(getDesktopRoomSidebarPanelPreference()).toBe('files');
  });
});
