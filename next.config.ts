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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
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
  async headers() {
    return [
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
