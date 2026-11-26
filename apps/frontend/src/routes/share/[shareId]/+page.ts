import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';

export const ssr = false;

export const load: PageLoad = async ({ params, fetch }) => {
  const { shareId } = params;

  if (!shareId) {
    throw error(400, 'Missing share ID');
  }

  // Validate share ID format (22 chars, base64url: A-Za-z0-9_-)
  if (!/^[A-Za-z0-9_-]{22}$/.test(shareId)) {
    throw error(400, 'Invalid share ID');
  }

  try {
    const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw error(404, 'Share data not found or expired');
      }
      throw error(response.status, 'Failed to load share data');
    }

    const data = await response.json();
    return {
      shareData: data
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    throw error(500, 'Failed to load share data');
  }
};
