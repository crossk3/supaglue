import { openApiErrorHandlerMiddleware, openapiMiddleware } from '@/middleware/openapi';
import { Router } from 'express';
import accounts from './account';
import associationTypes from './association_type';
import contacts from './contact';
import customObjectClasses from './custom_object_class';
import leads from './lead';
import opportunities from './opportunity';
import passthrough from './passthrough';
import users from './user';

export default function init(app: Router): void {
  const v2Router = Router();

  v2Router.use(openapiMiddleware('crm', 'v2'));

  contacts(v2Router);
  accounts(v2Router);
  leads(v2Router);
  opportunities(v2Router);
  users(v2Router);

  customObjectClasses(v2Router);
  associationTypes(v2Router);

  passthrough(v2Router);

  v2Router.use(openApiErrorHandlerMiddleware);

  app.use('/v2', v2Router);
}
