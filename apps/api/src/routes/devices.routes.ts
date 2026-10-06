import { deviceTokenParam, registerDeviceSchema } from '@stencil/shared';
import { deviceController as c } from '../controllers/device.controller';
import { createModule } from './registry';

/** Push-notification devices of the signed-in user (mobile app). */
export const deviceModule = createModule('Devices', '/api/v1/devices');

deviceModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Register this device for push notifications',
    description:
      'Upserts by Expo push token (`ExponentPushToken[...]` or `ExpoPushToken[...]`). A token already registered to another account is reassigned to the caller and re-enabled. Call after every sign-in, on app start, and after `change-password` — signing out everywhere, changing/resetting the password or deactivation removes all of the user\'s devices.',
    body: registerDeviceSchema,
  },
  c.register,
);
deviceModule.route({ method: 'get', path: '/', summary: 'List my registered devices' }, c.list);
deviceModule.route(
  {
    method: 'delete',
    path: '/:token',
    summary: 'Unregister one of my devices',
    description: 'URL-encode the token (it contains `[` and `]`). Returns 404 for unknown tokens or devices of other users. Call before `POST /auth/logout` on sign-out.',
    params: deviceTokenParam,
  },
  c.remove,
);
