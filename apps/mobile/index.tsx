/**
 * App entry.
 *
 * Equivalent to `expo-router/entry`, but the route context is created HERE, next
 * to the `app/` directory. The stock entry builds it from inside the
 * expo-router package, which fails when packages live on another drive (this
 * repo's pnpm virtual store is on C: while the app is on D:) — Windows cannot
 * express a relative path across drives, so no routes would be bundled.
 */
import '@expo/metro-runtime';
import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';

export function App() {
  const ctx = require.context('./app');
  return <ExpoRoot context={ctx} />;
}

registerRootComponent(App);
