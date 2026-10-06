// Generates Expo Router typed-route declarations (`.expo/types/router.d.ts`)
// without starting the dev server, so `tsc` can check `Href`s in CI.
// (`expo start` regenerates them automatically while developing.)
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const expoDir = path.dirname(require.resolve('expo/package.json', { paths: [projectRoot] }));
const cliDir = path.dirname(require.resolve('@expo/cli/package.json', { paths: [expoDir] }));
const typedRoutesPath = require.resolve('@expo/router-server/build/typed-routes', { paths: [cliDir] });

process.env.EXPO_ROUTER_APP_ROOT = path.join(projectRoot, 'app');
const typesDirectory = path.join(projectRoot, '.expo', 'types');
fs.mkdirSync(typesDirectory, { recursive: true });

const typedRoutes = require(typedRoutesPath);
typedRoutes.regenerateDeclarations(typesDirectory);
console.log(`Typed routes written to ${path.relative(projectRoot, typesDirectory)}`);
