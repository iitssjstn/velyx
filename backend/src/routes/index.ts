import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { authRoutes } from './auth.js';
import { libraryRoutes } from './library.js';
import { userDataRoutes } from './user-data.js';
import { mediaRoutes } from './media.js';
import { adminRoutes } from './admin.js';
import { collectionRoutes } from './collections.js';
import { segmentRoutes } from './segments.js';
import { activityRoutes } from './activity.js';
import { cleanupRoutes } from './cleanup.js';
import { notificationRoutes } from './notifications.js';
import { onlineSubtitleRoutes } from './online-subtitles.js';
import { cloudRoutes } from './cloud.js';
import { inviteRoutes } from './invites.js';
import { seerrRoutes } from './seerr.js';

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await authRoutes(app, ctx);
  await libraryRoutes(app, ctx);
  await userDataRoutes(app, ctx);
  await mediaRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await collectionRoutes(app, ctx);
  await segmentRoutes(app, ctx);
  await activityRoutes(app, ctx);
  await cleanupRoutes(app, ctx);
  await notificationRoutes(app, ctx);
  await onlineSubtitleRoutes(app, ctx);
  await cloudRoutes(app, ctx);
  await inviteRoutes(app, ctx);
  await seerrRoutes(app, ctx);
}
