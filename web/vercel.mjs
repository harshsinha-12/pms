const configuredOrigin = process.env.RAILWAY_API_ORIGIN?.trim();

if (!configuredOrigin) {
  throw new Error(
    "RAILWAY_API_ORIGIN is required. Set it to the Railway public origin, for example https://your-api.up.railway.app.",
  );
}

const railwayApiOrigin = configuredOrigin.replace(/\/+$/, "");
const parsedOrigin = new URL(railwayApiOrigin);

if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== railwayApiOrigin) {
  throw new Error(
    "RAILWAY_API_ORIGIN must be an HTTPS origin without a path or trailing slash.",
  );
}

export const config = {
  framework: "vite",
  buildCommand: "npm run build",
  outputDirectory: "dist/client",
  rewrites: [
    {
      source: "/api/:path*",
      destination: `${railwayApiOrigin}/api/:path*`,
    },
  ],
};
