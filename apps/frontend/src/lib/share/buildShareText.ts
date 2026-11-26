import type { ShareData } from '$lib/state/pendingShare';

/**
 * Build plain text content from share data with deduplication.
 *
 * Each piece (title, text, URL) is on a separate line with blank lines between.
 * The URL is only added if it's not already present in the text.
 */
export function buildShareText(shareData: ShareData): string {
  const lines: string[] = [];

  if (shareData.title) {
    lines.push(shareData.title);
  }

  if (shareData.text) {
    lines.push(shareData.text);
  }

  // Only add URL if it's not already in the text
  if (shareData.url) {
    const existingText = lines.join('\n');
    if (!existingText.includes(shareData.url)) {
      lines.push(shareData.url);
    }
  }

  return lines.join('\n\n').trim();
}
