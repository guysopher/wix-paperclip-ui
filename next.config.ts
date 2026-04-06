import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wix/design-system", "@wix/wix-ui-icons-common"],
  async redirects() {
    return [
      { source: "/feed", destination: "/activity", permanent: true },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/paperclip-api/:path*",
        destination: "http://localhost:3100/api/:path*",
      },
    ];
  },
};

export default nextConfig;
