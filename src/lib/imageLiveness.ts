import { fetchPublicHttpUrl, isSafeHttpUrl } from './publicUrl';

// Liveness probe: hasGoodImage() (imageQuality.ts) trusts URLs by HOSTNAME, but a trusted-host URL
// that 404s still renders as the letter-tile placeholder (the card's <img> onError). Verify the
// bytes actually load before shipping/keeping a URL. data: URIs always render.
//
// SERVER-ONLY (node DNS/http): kept out of imageQuality.ts, which is also bundled client-side.
//
// SSRF guard: imageURI is user-controllable on-chain metadata (user-created markets), so the probe
// must never reach private/internal hosts. fetchPublicHttpUrl validates the scheme + hostname AND
// pins the resolved public IP for the actual request (blocks DNS rebinding); it does not auto-follow
// redirects, so each hop below is re-validated the same way.
export async function imageUrlLoads(url: string | undefined | null): Promise<boolean> {
  if (!url) return false;
  let target = url.trim();
  if (target.startsWith('data:image/')) return true;
  for (let hop = 0; hop < 3; hop++) {
    if (!isSafeHttpUrl(target)) return false;
    try {
      // GET with a tiny range (some CDNs reject HEAD); any 2xx + image content-type counts as alive.
      const res = await fetchPublicHttpUrl(target, {
        headers: { Range: 'bytes=0-2047' },
        timeoutMs: 5_000,
        maxBytes: 64_000,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return false;
        target = new URL(location, target).toString();
        continue;
      }
      if (!(res.ok || res.status === 206)) return false;
      const type = res.headers.get('content-type') ?? '';
      return type.startsWith('image/');
    } catch {
      return false;
    }
  }
  return false;
}
