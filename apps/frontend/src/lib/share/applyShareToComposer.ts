import type { ShareData } from '$lib/state/pendingShare';
import { buildShareText } from './buildShareText';

/**
 * MessageComposerApi subset needed for applying shares.
 * Uses a local type to avoid coupling to messageComposerState internals.
 */
export type ComposerApi = {
  addFiles: (files: File[]) => Promise<void> | void;
  insertText: (text: string) => void;
  focus: () => void;
};

/**
 * Apply shared content to the composer: convert base64 files to File objects,
 * insert text, and focus the editor.
 *
 * @param shareData - The share data to apply
 * @param composerApi - The composer editor API
 * @returns Error message if loading fails, null otherwise
 */
export async function applyShareToComposer(
  shareData: ShareData,
  composerApi: ComposerApi
): Promise<string | null> {
  try {
    // Convert base64 files to File objects
    if (shareData.files && shareData.files.length > 0) {
      const files = await Promise.all(
        shareData.files.map(
          async (fileData: { data: string; contentType: string; filename: string }) => {
            const binary = atob(fileData.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: fileData.contentType });
            return new File([blob], fileData.filename, { type: fileData.contentType });
          }
        )
      );

      // Add files to composer
      await composerApi.addFiles(files);
    }

    // Build share text with deduplication
    const text = buildShareText(shareData);
    if (text) {
      composerApi.insertText(text);
    }

    // Focus composer (cursor is at the end after insertText)
    composerApi.focus();

    return null;
  } catch (error) {
    console.error('Error applying share to composer:', error);
    return 'Failed to load shared content';
  }
}
