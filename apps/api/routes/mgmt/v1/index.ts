import { apiKeyHeaderMiddleware } from '@/middleware/api_key';
import { openapiMiddleware } from '@/middleware/openapi';
import { Router } from 'express';
import customer from './customer';
import destination from './destination';
import forceSync from './force_sync';
import integration from './integration';
import syncHistory from './sync_history';
import syncInfo from './sync_info';
import syncMigration from './sync_migration';
import webhook from './webhook';

export default function init(app: Router): void {
  const v1Router = Router();

  v1Router.use(apiKeyHeaderMiddleware);
  v1Router.use(openapiMiddleware('mgmt'));

  customer(v1Router);
  destination(v1Router);
  integration(v1Router);
  webhook(v1Router);
  syncInfo(v1Router);
  syncHistory(v1Router);
  forceSync(v1Router);

  // TODO: Remove when we're done with migrating connections
  syncMigration(v1Router);

  app.use('/v1', v1Router);
}
