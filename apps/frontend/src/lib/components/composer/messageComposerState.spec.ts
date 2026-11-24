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

describe('MessageComposerState insertText race condition', () => {
	it('queues text when insertText called before editor ready, flushes exactly once after ready', async () => {
		// Create a minimal fake editor API
		const fakeEditor: ComposerEditorApi = {
			getText: vi.fn(() => ''),
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

		// Create minimal dependencies
		const mockDependencies = {
			draftReplies: {
				drafts: new Map(),
				setDraft: vi.fn(),
				clearDraft: vi.fn()
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
			serverInfo: {
				status: 'ready',
				versionInfo: null,
				serverFeatures: {},
				serverCapabilities: {},
				serverUsage: null,
				notificationSettings: null,
				serverId: 'server-1'
			} as ServerInfoState,
			roomUnreadStore: {
				setRoomUnread: vi.fn()
			},
			getMessageAPI: () =>
				({
					sendMessage: vi.fn(),
					updateMessage: vi.fn()
				}) as ReturnType<typeof createMessageAPI>,
			getLinkPreviewAPI: () =>
				({
					requestPreview: vi.fn()
				}) as ReturnType<typeof createLinkPreviewAPI>
		};

		const composerState = new MessageComposerState(mockDependencies);

		// Step 1: Call insertText before editor is ready (should queue it)
		const testText = 'Share title\n\nShare text\n\nhttps://example.com';
		composerState.insertText(testText);

		// Verify insertText was not called on editor (because it doesn't exist yet)
		expect(fakeEditor.insertText).not.toHaveBeenCalled();

		// Step 2: Editor becomes ready
		composerState.handleEditorReady(fakeEditor);

		// Verify insertText was called exactly once with the queued text
		// (setContent may or may not be called depending on message state)
		expect(fakeEditor.insertText).toHaveBeenCalledOnce();
		expect(fakeEditor.insertText).toHaveBeenCalledWith(testText);

		// Step 3: Call insertText again after editor is ready
		const secondText = 'More text';
		composerState.insertText(secondText);

		// Wait for tick
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Verify insertText was called again (total 2 times now)
		expect(fakeEditor.insertText).toHaveBeenCalledTimes(2);
		expect(fakeEditor.insertText).toHaveBeenNthCalledWith(2, secondText);
	});
});
