import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPublicHttpUrl, resolvePublicHttpUrl } from '../publicUrl';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mocks.lookup },
  lookup: mocks.lookup,
}));

describe('publicUrl', () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
  });

  it('rejects hostnames that do not resolve before server-side fetches', async () => {
    mocks.lookup.mockResolvedValue([]);

    await expect(assertPublicHttpUrl('https://example.com/story')).rejects.toThrow('does not resolve');
  });

  it('rejects hostnames that resolve to private networks', async () => {
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(assertPublicHttpUrl('https://example.com/story')).rejects.toThrow('private network');
  });

  it('returns the parsed URL for public DNS records', async () => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(assertPublicHttpUrl('https://example.com/story')).resolves.toMatchObject({
      hostname: 'example.com',
    });
  });

  it('returns the validated DNS record used for pinned fetches', async () => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(resolvePublicHttpUrl('https://example.com/story')).resolves.toMatchObject({
      url: expect.objectContaining({ hostname: 'example.com' }),
      record: { address: '93.184.216.34', family: 4 },
    });
  });
});
