export type SnakecasedCrmTenantFields = {
  _supaglue_application_id: string;
  _supaglue_provider_name: string;
  _supaglue_customer_id: string;
  _supaglue_emitted_at: Date;
};

export type BaseCrmModel = {
  id: string;
  remoteId: string;
  remoteCreatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  remoteWasDeleted: boolean;
  lastModifiedAt: Date;
  rawData?: Record<string, any>;
};

export type BaseCrmModelV2 = {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  isDeleted: boolean;
  lastModifiedAt: Date;
  rawData: Record<string, any>;
};
