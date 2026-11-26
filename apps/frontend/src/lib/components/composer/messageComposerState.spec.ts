import { describe, expect, it, vi } from 'vitest';
import type { ComposerEditorApi } from './editorTypes';
import type { ServerInfoState } from '@chatto/client/server/state';
import type { createMessageAPI } from '@chatto/client/api/messages';
import type { createLinkPreviewAPI } from '@chatto/client/api/linkPreviews';

// Mock useDebounce to avoid Svelte context errors in unit tests
vi.mock('$lib/hooks/useDebounce.svelte', () => ({
  useDebounce: () => ({
    run: vi.fn((fn: () => void) => fn()),
    cancel: vi.fn()
  })
}));

// Mock onDestroy to avoid Svelte context errors
vi.mock('svelte', async () => {
  const actual = await vi.importActual('svelte');
  return {
    ...actual,
    onDestroy: vi.fn()
  };
});

import { MessageComposerState } from './messageComposerState.svelte';

function createFakeEditor(getText = () => ''): ComposerEditorApi {
  return {
    getText: vi.fn(getText),
    setContent: vi.fn(),
    focus: vi.fn(),
    performEnter: vi.fn(),
    getTextBeforeCursor: vi.fn(() => ''),
    isInCodeBlock: vi.fn(() => false),
    replaceTextBeforeCursor: vi.fn(),
    insertText: vi.fn(),
    insertQuote: vi.fn(),
    toggleFormatting: vi.fn(),
    adjustIndent: vi.fn(() => false)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockDependencies(): any {
  return {
    draftReplies: {
      drafts: new Map(),
      setDraft: vi.fn(),
      clearDraft: vi.fn(),
      select: vi.fn(),
      clearMessage: vi.fn(),
      clearRoom: vi.fn(),
      clear: vi.fn()
    },
    getRoomId: () => 'room-1',
    getThreadRootEventId: () => undefined,
    getCanPost: () => true,
    getCanAttach: () => true,
    getSlowModeBlocked: () => false,
    getCanCreateThread: () => false,
    getCreateThreadRequired: () => false,
    getCreateThreadDefault: () => false,
    getRecentThreadRootCandidate: () => null,
    getAutoFocus: () => false,
    getComposerSendMode: () => 'enter' as const,
    getPlaceholder: () => undefined,
    getOnReady: () => undefined,
    getCallbacks: () => ({}),
    context: {
      editState: { eventId: null, originalBody: '', cancelEdit: vi.fn(), startEdit: vi.fn() },
      replyState: { messageEventId: null, cancelReply: vi.fn() },
      quoteInsertionState: { request: null },
      scrollState: { requestScrollToBottom: vi.fn() },
      lastEditableMessage: undefined
    },
    getMembers: () => [],
    getMentionPriorityUserIds: () => undefined,
    membersStore: {
      searchMembers: vi.fn(() => Promise.resolve([]))
    },
    mentionRolesStore: {
      status: 'idle' as const,
      roles: [],
      load: vi.fn(() => Promise.resolve())
    },
    serverInfo: {} as unknown as ServerInfoState,
    roomUnreadStore: {
      setRoomUnread: vi.fn()
    },
    getMessageAPI: () => ({}) as ReturnType<typeof createMessageAPI>,
    getLinkPreviewAPI: () => ({}) as ReturnType<typeof createLinkPreviewAPI>
  };
}

describe('MessageComposerState insertText', () => {
  it('queues text when insertText called before editor ready, flushes exactly once after ready', async () => {
    const fakeEditor = createFakeEditor();
    const composerState = new MessageComposerState(createMockDependencies());

    const testText = 'Share title\n\nShare text\n\nhttps://example.com';
    composerState.insertText(testText);

    expect(fakeEditor.insertText).not.toHaveBeenCalled();

    composerState.handleEditorReady(fakeEditor);

    expect(fakeEditor.insertText).toHaveBeenCalledOnce();
    expect(fakeEditor.insertText).toHaveBeenCalledWith(testText);

    const secondText = 'More text';
    composerState.insertText(secondText);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeEditor.insertText).toHaveBeenCalledTimes(2);
    expect(fakeEditor.insertText).toHaveBeenNthCalledWith(2, secondText);
  });

  it('separates an existing draft from queued share text with a blank line', () => {
    const fakeEditor = createFakeEditor();
    const composerState = new MessageComposerState(createMockDependencies());
    composerState.message = 'Existing draft';

    composerState.insertText('Shared link');
    composerState.handleEditorReady(fakeEditor);

    expect(fakeEditor.insertText).toHaveBeenCalledOnce();
    expect(fakeEditor.insertText).toHaveBeenCalledWith('\n\nShared link');
  });

  it('separates existing editor text from insertText with a blank line', async () => {
    const fakeEditor = createFakeEditor(() => 'Existing draft');
    const composerState = new MessageComposerState(createMockDependencies());
    composerState.handleEditorReady(fakeEditor);

    composerState.insertText('Shared link');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeEditor.insertText).toHaveBeenCalledOnce();
    expect(fakeEditor.insertText).toHaveBeenCalledWith('\n\nShared link');
  });
});
