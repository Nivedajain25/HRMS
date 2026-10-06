import type { RegisterDeviceInput } from '@stencil/shared';
import { body } from '../middleware/validate';
import * as devices from '../services/device.service';
import { handle } from '../utils/controller';

export const deviceController = {
  register: handle((ctx, req) => devices.registerDevice(ctx, body<RegisterDeviceInput>(req)), 'Device registered'),
  list: handle((ctx) => devices.listDevices(ctx)),
  remove: handle(async (ctx, req) => {
    await devices.removeDevice(ctx, String(req.params.token));
    return null;
  }, 'Device removed'),
};
