import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfkit'],
  outputFileTracingIncludes: { '/api/seminars/*/outline/pdf': ['./assets/fonts/**'] },
  outputFileTracingExcludes: { '/*': ['./data/**', './.env*'] },
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] }];
  },
};

export default nextConfig;
