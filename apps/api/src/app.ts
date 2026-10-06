import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isProd, isTest } from './config/env';
import { databaseStatus } from './config/database';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiLimiter, sanitizeInput } from './middleware/security';
import { mountRoutes } from './routes';
import { buildOpenApiDocument } from './routes/registry';
import { usingRedis } from './jobs/queue';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: {
        useDefaults: true,
        // Swagger UI needs inline styles/scripts; everything else is JSON.
        directives: { 'script-src': ["'self'", "'unsafe-inline'"], 'style-src': ["'self'", "'unsafe-inline'"] },
      },
    }),
  );
  const allowedOrigins = env.CLIENT_URL.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(sanitizeInput);
  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/health' },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  app.get('/health', (_req, res) => {
    const db = databaseStatus();
    const healthy = db === 'connected';
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: {
        status: healthy ? 'ok' : 'degraded',
        api: 'up',
        database: db,
        jobs: usingRedis() ? 'redis' : 'in-process',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use('/api', apiLimiter);
  mountRoutes(app);

  const openApi = buildOpenApiDocument(env.API_URL);
  app.get('/api/docs.json', (_req, res) => res.json(openApi));
  if (!isProd || process.env.ENABLE_SWAGGER === 'true') {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: 'Stencil HRMS API' }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
