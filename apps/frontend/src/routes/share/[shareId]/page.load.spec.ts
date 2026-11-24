import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page';

describe('share page load', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch = vi.fn();
	});

	it('fetches share data from API', async () => {
		const mockShareData = {
			id: 'test-share-id',
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
			params: { shareId: 'test-share-id' },
			fetch: mockFetch
		} as never);

		expect(mockFetch).toHaveBeenCalledWith('/api/share/test-share-id');
		expect(result).toEqual({ shareData: mockShareData });
	});

	it('throws 404 when share data not found', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 404
		});

		await expect(
			load({
				params: { shareId: 'nonexistent' },
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

	it('handles fetch errors gracefully', async () => {
		mockFetch.mockRejectedValue(new Error('Network error'));

		await expect(
			load({
				params: { shareId: 'test-id' },
				fetch: mockFetch
			} as never)
		).rejects.toMatchObject({
			status: 500,
			body: { message: 'Failed to load share data' }
		});
	});

	it('handles non-404 HTTP errors', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500
		});

		await expect(
			load({
				params: { shareId: 'test-id' },
				fetch: mockFetch
			} as never)
		).rejects.toMatchObject({
			status: 500,
			body: { message: 'Failed to load share data' }
		});
	});
});
