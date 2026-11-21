/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Express API is reached through app/device/[...path]/route.ts, so the
  // backend URL is read at runtime (API_URL), not fixed at build time.
  reactStrictMode: true,
};

export default nextConfig;
