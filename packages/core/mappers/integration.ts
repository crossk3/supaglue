import type { Integration as IntegrationModel, Prisma } from '@supaglue/db';
import {
  Integration,
  IntegrationConfigDecrypted,
  IntegrationConfigEncrypted,
  IntegrationCreateParams,
  ProviderCategory,
  ProviderName,
} from '@supaglue/types';
import { decryptFromString, encryptAsString } from '../lib/crypt';

export const fromIntegrationModel = async ({
  id,
  applicationId,
  destinationId,
  category,
  providerName,
  config,
}: IntegrationModel): Promise<Integration> => {
  // TODO: We should update the prisma schema
  if (!config) {
    throw new Error('Integration config is missing');
  }

  return {
    id,
    applicationId,
    destinationId,
    category: category as ProviderCategory,
    authType: 'oauth2',
    providerName: providerName as ProviderName,
    config: await fromIntegrationConfigModel(config),
  } as Integration; // TODO: better type;
};

const fromIntegrationConfigModel = async (config: Prisma.JsonValue): Promise<IntegrationConfigDecrypted> => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Integration config is missing');
  }
  const integrationConfig = config as unknown as IntegrationConfigEncrypted;
  return {
    ...integrationConfig,
    oauth: {
      ...integrationConfig.oauth,
      credentials: JSON.parse(await decryptFromString(integrationConfig.oauth.credentials)),
    },
  };
};

export const toIntegrationModel = async ({
  applicationId,
  destinationId,
  category,
  authType,
  providerName,
  config,
}: IntegrationCreateParams) => {
  return {
    applicationId,
    category,
    authType,
    destinationId,
    providerName,
    config: config
      ? {
          ...config,
          oauth: {
            ...config.oauth,
            credentials: await encryptAsString(JSON.stringify(config.oauth.credentials)),
          },
        }
      : undefined,
  };
};
