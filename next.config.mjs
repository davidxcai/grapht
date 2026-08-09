import { networkInterfaces } from 'node:os';

// Testing on a phone hits `next dev` via the machine's LAN IP, which dev treats
// as cross-origin and blocks from loading /_next/* — the page then renders but
// never hydrates. Read the addresses off the interfaces so a new lease on the
// network doesn't need a config edit.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The pipeline modules in src/ are plain Node ESM and use sharp / tfjs.
  // Keep them server-side only; nothing here should reach the browser bundle.
  serverExternalPackages: ['sharp', '@tensorflow/tfjs', '@tensorflow-models/blazeface'],

  allowedDevOrigins: lanAddresses,

  images: {
    // Captures live in a private Vercel Blob store (lib/capture.ts,
    // app/trials/actions.ts) — every store gets its own random hostname under
    // this suffix, so the pattern has to be a wildcard rather than one fixed host.
    remotePatterns: [
      { protocol: 'https', hostname: '*.private.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'img.clerk.com' },
    ],
  },

  experimental: {
    // Server actions cap request bodies at 1MB, and a capture is a full-size
    // photo — HD analysis needs at least 1080px on the short side, so anything
    // under the cap would be too small to analyse. `checkImage()` in
    // lib/capture.ts rejects at 20MB; this leaves headroom for the rest of the
    // form travelling in the same request.
    serverActions: { bodySizeLimit: '25mb' },
  },
};

export default nextConfig;
