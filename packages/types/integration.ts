import { OAuthConfigDecrypted, OAuthConfigEncrypted } from '.';
import { CRMProviderName } from './crm';
import { EngagementProviderName } from './engagement';
import { IntegrationSyncConfig } from './sync_config';

type BaseIntegration = {
  id: string;
  applicationId: string;
  authType: 'oauth2';
  destinationId: string | null;
};

export type CRMIntegration = BaseIntegration & {
  category: 'crm';
  providerName: CRMProviderName;
  config: IntegrationConfigDecrypted;
};

export type EngagementIntegration = BaseIntegration & {
  category: 'engagement';
  providerName: EngagementProviderName;
  config: IntegrationConfigDecrypted;
};

export type IntegrationConfigDecrypted = {
  providerAppId: string;
  oauth: OAuthConfigDecrypted;
  sync: IntegrationSyncConfig;
};

export type IntegrationConfigEncrypted = {
  providerAppId: string;
  oauth: OAuthConfigEncrypted;
  sync: IntegrationSyncConfig;
};

// TODO: Update params should not contain applicationId even if create params does.
export type CRMIntegrationCreateParams = Omit<CRMIntegration, 'id'>;
export type CRMIntegrationUpdateParams = Omit<CRMIntegration, 'id'>;

export type EngagementIntegrationCreateParams = Omit<EngagementIntegration, 'id'>;
export type EngagementIntegrationUpdateParams = Omit<EngagementIntegration, 'id'>;

export type Integration = CRMIntegration | EngagementIntegration;
export type IntegrationCreateParams = CRMIntegrationCreateParams | EngagementIntegrationCreateParams;
export type IntegrationUpdateParams = CRMIntegrationUpdateParams | EngagementIntegrationUpdateParams;
