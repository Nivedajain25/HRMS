import { defineConfig } from 'tsup';

export default defineConfig({
  // Named entries → dist/server.js, dist/worker.js, dist/seed.js
  entry: {
    server: 'src/server.ts',
    worker: 'src/jobs/worker.ts',
    seed: 'src/seed/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // Bundle workspace packages (they ship TypeScript source); keep npm deps external.
  noExternal: [/^@stencil\//],
});
