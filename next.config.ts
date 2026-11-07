import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfkit'],
  outputFileTracingIncludes: { '/api/seminars/*/outline/pdf': ['./assets/fonts/**'], '/api/seminars/*/participants/*/receipt/pdf':['./assets/fonts/**'], '/api/seminars/*/participants':['./assets/fonts/**'], '/api/seminars/*/participants/*':['./assets/fonts/**'], '/api/seminars/*/participant-mail':['./assets/fonts/**'], '/api/forms/*':['./assets/fonts/**'], '/api/mail-history/*/attachment':['./assets/fonts/**'] },
  outputFileTracingExcludes: { '/*': ['./data/**', './.env*'] },
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] }];
  },
};

export default nextConfig;
