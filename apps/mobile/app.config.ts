import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Stencil HRMS mobile app configuration.
 *
 * Environment (set per EAS build profile in `eas.json` → `env`, or in a local `.env`):
 *  - `EXPO_PUBLIC_API_URL`  Origin of the Stencil deployment, e.g. `https://hr.example.com`
 *                           (the API is served under `/api/v1`). Must be public HTTPS for phones.
 *  - `EAS_PROJECT_ID`       EAS project id (from `eas init`); required for Expo push tokens.
 *  - `ANDROID_VERSION_CODE` Android version code for builds outside EAS (GitHub Actions passes its run number).
 */
/** Whether a file exists next to this config (read at build time, in Node). */
const hasFile = (root: string, name: string): boolean => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsModule = require('fs') as { existsSync: (p: string) => boolean };
  return fsModule.existsSync(`${root}/${name}`);
};

const BRAND = '#4f46e5';
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
const projectId = process.env.EAS_PROJECT_ID;

/**
 * Release builds block plain-HTTP traffic. Allow it only when the build targets an
 * `http://` API (the `lan` EAS profile: a server on the office Wi-Fi) — HTTPS builds stay locked down.
 */
const withCleartextForHttpApi: ConfigPlugin = (cfg) =>
  apiUrl.startsWith('http://')
    ? withAndroidManifest(cfg, (mod) => {
        const app = mod.modResults.manifest.application?.[0];
        if (app) app.$['android:usesCleartextTraffic'] = 'true';
        return mod;
      })
    : cfg;

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => withCleartextForHttpApi({
  ...config,
  name: 'Stencil HRMS',
  slug: 'stencil-hrms',
  scheme: 'stencilhrms',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#f6f7f9',
  primaryColor: BRAND,
  ios: {
    bundleIdentifier: 'com.stencilindia.hrms',
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription:
        'Stencil HRMS uses the camera to take a selfie when you clock in or out, and to photograph receipts and documents.',
      NSLocationWhenInUseUsageDescription: 'Stencil HRMS records your location when you clock in or out, as required by your organization.',
      NSPhotoLibraryUsageDescription: 'Stencil HRMS lets you attach photos such as receipts and supporting documents.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.stencilindia.hrms',
    // Firebase project (push notifications through FCM); builds without the file simply have no Firebase push.
    ...(hasFile(projectRoot, 'google-services.json') ? { googleServicesFile: './google-services.json' } : {}),
    // GitHub Actions builds pass their run number, so each new APK installs as an update of the last.
    ...(Number(process.env.ANDROID_VERSION_CODE) > 0 ? { versionCode: Number(process.env.ANDROID_VERSION_CODE) } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      monochromeImage: './assets/images/adaptive-icon-monochrome.png',
      backgroundColor: BRAND,
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.POST_NOTIFICATIONS',
      // In-app updates: hand a downloaded APK to Android's installer.
      'android.permission.REQUEST_INSTALL_PACKAGES',
    ],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.ACCESS_BACKGROUND_LOCATION'],
  },
  web: {
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
        resizeMode: 'contain',
        backgroundColor: '#f6f7f9',
        dark: { image: './assets/images/splash-icon.png', backgroundColor: '#0b0d12' },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'Stencil HRMS uses the camera to take a selfie when you clock in or out, and to photograph receipts and documents.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Stencil HRMS records your location when you clock in or out, as required by your organization.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Stencil HRMS lets you attach photos such as receipts and supporting documents.',
        cameraPermission: 'Stencil HRMS uses the camera to photograph receipts and documents.',
        microphonePermission: false,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: BRAND,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    ...config.extra,
    apiUrl,
    ...(projectId ? { eas: { projectId } } : {}),
  },
}) as ExpoConfig;
