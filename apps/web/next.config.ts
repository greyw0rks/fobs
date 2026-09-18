import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Moved out of `experimental` in Next 15; the old location is deprecated.
  typedRoutes: true
};

export default nextConfig;
