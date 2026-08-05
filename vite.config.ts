import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs. Portals serve games from a nested path
  // (crazygames.com/gamefiles/<slug>/…), and absolute "/assets/…" links 404
  // there while working perfectly in local dev — a failure you only discover
  // after submission.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    // No sourcemap in the shipped bundle: it is 3 MB against a ~630 kB game and
    // counts toward the upload the portal reviews. Flip it on locally when
    // debugging a production-only issue.
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    target: 'es2020',
  },
});
