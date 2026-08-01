import type { NextConfig } from 'next';

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // No external <script src> in the app (all bundled), so scripts are 'self' only — drops the
      // broad `https:` that let any origin serve code. 'unsafe-inline' stays for Next's hydration
      // bootstrap; full 'unsafe-eval' is replaced with 'wasm-unsafe-eval' so Circle's WASM wallets
      // keep working while arbitrary JS eval (a classic XSS sink) is blocked.
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https:",
      "worker-src 'self' blob:",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), clipboard-write=(self)' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

const embedSecurityHeaders = securityHeaders
  .filter((header) => header.key !== 'X-Frame-Options')
  .map((header) => header.key === 'Content-Security-Policy'
    ? {
        key: header.key,
        value: header.value.replace("frame-ancestors 'none'", 'frame-ancestors *'),
      }
    : header);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Ship the committed market-list seed (the Neon-independent cold-start floor) inside the API
  // route bundles. Without this, the runtime fs.readFileSync(process.cwd()/data/markets-seed.json)
  // in the snapshot fallback would 404 in the serverless function and the grid could still hang
  // when Neon is down. Traced as an asset (not parsed into JS) so it doesn't bloat cold start.
  outputFileTracingIncludes: {
    '/api/**': ['./data/markets-seed.json'],
  },
  async redirects() {
    return [
      {
        source: '/:path((?!api/).*)',
        has: [
          {
            type: 'host',
            value: 'presto-markets.vercel.app',
          },
        ],
        destination: 'https://presto-markets.pages.dev/:path*',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, x-presto-auth' },
        ],
      },
      {
        source: '/embed/:path*',
        headers: embedSecurityHeaders,
      },
      {
        source: '/((?!embed/).*)',
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@react-native-async-storage\/async-storage$/,
      }),
      new webpack.IgnorePlugin({
        resourceRegExp: /^pino-pretty$/,
      }),
    );

    return config;
  },
};

export default nextConfig;
