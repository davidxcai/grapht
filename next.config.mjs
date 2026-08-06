/** @type {import('next').NextConfig} */
const nextConfig = {
  // The pipeline modules in src/ are plain Node ESM and use sharp / tfjs.
  // Keep them server-side only; nothing here should reach the browser bundle.
  serverExternalPackages: ['sharp', '@tensorflow/tfjs', '@tensorflow-models/blazeface'],

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
