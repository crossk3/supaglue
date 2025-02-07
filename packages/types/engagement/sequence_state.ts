import { SnakecasedKeys } from '../snakecased_keys';
import { BaseEngagementModel, BaseEngagementModelV2, SnakecasedEngagementTenantFields } from './base';

export type SnakecasedKeysSequenceState = SnakecasedKeys<SequenceState>;
export type SnakecasedKeysSequenceStateV2 = SnakecasedKeys<SequenceStateV2>;
export type SnakecasedKeysSequenceStateV2WithTenant = SnakecasedKeysSequenceStateV2 & SnakecasedEngagementTenantFields;

type CoreSequenceState = {
  state: string | null;
  contactId: string | null;
  sequenceId: string | null;
  mailboxId: string | null;
};

// TODO: Rename/consolidate when we move entirely to managed syncs
export type SequenceState = BaseEngagementModel & CoreSequenceState;

export type SequenceStateV2 = BaseEngagementModelV2 & CoreSequenceState;

export type SequenceStateCreateParams = {
  contactId: string;
  sequenceId: string;
  mailboxId: string;
};

export type RemoteSequenceStateTypes = {
  object: SequenceStateV2;
  createParams: SequenceStateCreateParams;
  updateParams: never;
};
