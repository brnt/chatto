import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page';

describe('share page load', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('fetches share data from API', async () => {
    const validShareId = 'abcdefghijklmnopqrstuv'; // 22 chars
    const mockShareData = {
      id: validShareId,
      title: 'Test Title',
      text: 'Test content',
      url: 'https://example.com',
      files: []
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockShareData
    });

    const result = await load({
      params: { shareId: validShareId },
      fetch: mockFetch
    } as never);

    expect(mockFetch).toHaveBeenCalledWith(`/api/share/${encodeURIComponent(validShareId)}`);
    expect(result).toEqual({ shareData: mockShareData });
  });

  it('throws 404 when share data not found', async () => {
    const validShareId = 'wxyzabcdefghijklmnopqr'; // 22 chars
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404
    });

    await expect(
      load({
        params: { shareId: validShareId },
        fetch: mockFetch
      } as never)
    ).rejects.toMatchObject({
      status: 404,
      body: { message: 'Share data not found or expired' }
    });
  });

  it('throws 400 when share ID is missing', async () => {
    await expect(
      load({
        params: { shareId: '' },
        fetch: mockFetch
      } as never)
    ).rejects.toMatchObject({
      status: 400,
      body: { message: 'Missing share ID' }
    });
  });

  it('throws 400 when share ID format is invalid', async () => {
    await expect(
      load({
        params: { shareId: 'invalid' }, // Only 7 chars, not 22
        fetch: mockFetch
      } as never)
    ).rejects.toMatchObject({
      status: 400,
      body: { message: 'Invalid share ID' }
    });
  });

  it('handles fetch errors gracefully', async () => {
    const validShareId = '123456789012345678901a'; // 22 chars
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(
      load({
        params: { shareId: validShareId },
        fetch: mockFetch
      } as never)
    ).rejects.toMatchObject({
      status: 500,
      body: { message: 'Failed to load share data' }
    });
  });

  it('handles non-404 HTTP errors', async () => {
    const validShareId = '123456789012345678901b'; // 22 chars
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500
    });

    await expect(
      load({
        params: { shareId: validShareId },
        fetch: mockFetch
      } as never)
    ).rejects.toMatchObject({
      status: 500,
      body: { message: 'Failed to load share data' }
    });
  });
});
