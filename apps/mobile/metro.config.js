// Metro configuration for the Stencil HRMS pnpm monorepo.
//
// `expo/metro-config` already detects the workspace root: it watches the repo
// root (so `packages/shared` / `packages/types` TypeScript sources are
// transpiled by Babel like app code) and resolves `node_modules` from both the
// app and the root. Symlinks (pnpm's isolated layout) are supported by Metro
// out of the box.
//
// On this workstation pnpm's virtual store lives OUTSIDE the repository
// (`virtual-store-dir` in the root `.npmrc`, e.g. `C:/stencil-hrms-pnpm/virtual`),
// so the real package files are not under any watched folder. We detect that
// location from where `expo` actually resolves to and add it to `watchFolders`.
// In CI / EAS (default `node_modules/.pnpm`) this is a no-op.
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Root of pnpm's virtual store when it is outside the repo, e.g. `C:\stencil-hrms-pnpm\virtual`. */
const externalVirtualStore = () => {
  try {
    const expoDir = fs.realpathSync(path.dirname(require.resolve('expo/package.json', { paths: [projectRoot] })));
    // <store>/<name@version_hash>/node_modules/expo
    const store = path.resolve(expoDir, '..', '..', '..');
    return isInside(store, workspaceRoot) ? null : store;
  } catch {
    return null;
  }
};

const store = externalVirtualStore();
if (store) {
  config.watchFolders = [...new Set([...(config.watchFolders ?? []), store])];
}

module.exports = config;
