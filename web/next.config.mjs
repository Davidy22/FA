/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: isProd ? basePath : '',
  assetPrefix: isProd && basePath ? basePath : undefined,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['three'],
};

export default nextConfig;
