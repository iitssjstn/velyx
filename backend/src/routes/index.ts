import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { authRoutes } from './auth.js';
import { libraryRoutes } from './library.js';
import { userDataRoutes } from './user-data.js';
import { mediaRoutes } from './media.js';
import { adminRoutes } from './admin.js';
import { collectionRoutes } from './collections.js';

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await authRoutes(app, ctx);
  await libraryRoutes(app, ctx);
  await userDataRoutes(app, ctx);
  await mediaRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await collectionRoutes(app, ctx);
}
