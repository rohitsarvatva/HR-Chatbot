/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/**/*"],
  },
};

export default nextConfig;
