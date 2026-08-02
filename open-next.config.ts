import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// OpenNext first produces one complete standalone runtime. The Cloudflare build
// script then clones and prunes it serially into Free-plan-sized route Workers.
export default defineCloudflareConfig();
