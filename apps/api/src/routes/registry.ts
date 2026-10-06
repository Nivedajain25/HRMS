import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Permission } from '@stencil/shared';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validate';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface EndpointSpec {
  method: Method;
  path: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  /**
   * Swagger-only, optional request body (not validated by the registry). For
   * endpoints that validate a body conditionally in `before` middleware.
   */
  docBody?: z.ZodType;
  /** Documents the optional `X-Client: mobile` header (mobile auth mode). */
  mobileClientHeader?: boolean;
  query?: z.ZodType;
  params?: z.ZodType;
  /** All of these are required. */
  permissions?: Permission[];
  /** Any one of these is required. */
  anyPermission?: Permission[];
  public?: boolean;
  /** Extra middleware run before validation (e.g. multipart upload). */
  before?: RequestHandler[];
  /** Response is a file/stream rather than JSON. */
  binary?: boolean;
  multipart?: boolean;
}

interface RegisteredEndpoint extends EndpointSpec {
  fullPath: string;
  tag: string;
}

/** Global registry used to build the OpenAPI document. */
export const endpointRegistry: RegisteredEndpoint[] = [];

/**
 * Creates a module router. Each `route()` call wires authentication,
 * authorization and Zod validation, and registers the endpoint for Swagger.
 */
export const createModule = (tag: string, basePath: string) => {
  const router = Router();
  const route = (spec: EndpointSpec, handler: RequestHandler) => {
    const chain: RequestHandler[] = [];
    if (!spec.public) chain.push(authenticate);
    if (spec.permissions?.length) chain.push(requirePermission(...spec.permissions));
    if (spec.anyPermission?.length) chain.push(requireAnyPermission(...spec.anyPermission));
    if (spec.before) chain.push(...spec.before);
    if (spec.body || spec.query || spec.params) chain.push(validate({ body: spec.body, query: spec.query, params: spec.params }));
    chain.push(handler);
    router[spec.method](spec.path, ...chain);
    endpointRegistry.push({ ...spec, tag, fullPath: `${basePath}${spec.path === '/' ? '' : spec.path}` });
  };
  return { router, route, basePath };
};

const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output' = 'input') => {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
};

/** Builds an OpenAPI 3.1 document from registered endpoints. */
export const buildOpenApiDocument = (serverUrl: string) => {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const ep of endpointRegistry) {
    const oaPath = ep.fullPath.replace(/:([A-Za-z]+)/g, '{$1}');
    const parameters: Record<string, unknown>[] = [];
    for (const m of ep.fullPath.matchAll(/:([A-Za-z]+)/g)) {
      parameters.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
    }
    if (ep.mobileClientHeader) {
      parameters.push({
        name: 'X-Client',
        in: 'header',
        required: false,
        description: 'Send `mobile` from native apps: the refresh token is exchanged in the JSON body instead of the `stencil_rt` cookie.',
        schema: { type: 'string', enum: ['mobile'] },
      });
    }
    if (ep.query) {
      const js = toJsonSchema(ep.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        parameters.push({ name, in: 'query', required: js.required?.includes(name) ?? false, schema });
      }
    }
    const perms = [
      ...(ep.permissions ?? []).map((p) => `\`${p}\``),
      ...(ep.anyPermission?.length ? [`any of ${ep.anyPermission.map((p) => `\`${p}\``).join(', ')}`] : []),
    ];
    const operation: Record<string, unknown> = {
      tags: [ep.tag],
      summary: ep.summary,
      description: [ep.description, perms.length ? `**Requires:** ${perms.join(', ')}` : undefined].filter(Boolean).join('\n\n') || undefined,
      parameters,
      security: ep.public ? [] : [{ bearerAuth: [] }],
      responses: {
        '200': {
          description: ep.binary ? 'File' : 'Success',
          content: ep.binary
            ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
            : { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
        },
        '400': { $ref: '#/components/responses/Error' },
        '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' },
        '404': { $ref: '#/components/responses/Error' },
      },
    };
    if (ep.body) {
      const content = ep.multipart
        ? { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, ...((toJsonSchema(ep.body).properties as object) ?? {}) } } } }
        : { 'application/json': { schema: toJsonSchema(ep.body) } };
      operation.requestBody = { required: true, content };
    } else if (ep.docBody) {
      operation.requestBody = { required: false, content: { 'application/json': { schema: toJsonSchema(ep.docBody) } } };
    } else if (ep.multipart) {
      operation.requestBody = {
        required: true,
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } },
      };
    }
    paths[oaPath] ??= {};
    paths[oaPath][ep.method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Stencil HRMS API',
      version: '1.0.0',
      description:
        'REST API for Stencil HRMS. Authenticate with `POST /api/v1/auth/login` and send the returned `accessToken` as a Bearer token. All data is scoped to the authenticated user\'s organization.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Success: {
          type: 'object',
          properties: { success: { type: 'boolean', const: true }, data: {}, message: { type: 'string' }, pagination: { $ref: '#/components/schemas/Pagination' } },
        },
        Pagination: {
          type: 'object',
          properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: false },
            message: { type: 'string' },
            code: { type: 'string' },
            errors: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
          },
        },
      },
      responses: {
        Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
    paths,
  };
};
