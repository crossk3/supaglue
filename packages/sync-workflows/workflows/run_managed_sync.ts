import { CommonModelType, ProviderCategory } from '@supaglue/types/common';
import { CRMCommonModelType, CRM_COMMON_MODEL_TYPES } from '@supaglue/types/crm';
import {
  CRMNumRecordsSyncedMap,
  EngagementNumRecordsSyncedMap,
  FullOnlySync,
  FullThenIncrementalSync,
  NumRecordsSyncedMap,
} from '@supaglue/types/sync';
import { ActivityFailure, ApplicationFailure, proxyActivities, uuid4 } from '@temporalio/workflow';
// Only import the activity types
import { EngagementCommonModelType, ENGAGEMENT_COMMON_MODEL_TYPES } from '@supaglue/types/engagement';
import type { createActivities } from '../activities/index';
import { SyncRecordsToDestinationResult } from '../activities/sync_records_to_destination';

const { syncRecordsToDestination } = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '120 minute',
  heartbeatTimeout: '15 minute',
  retry: {
    maximumAttempts: 3,
  },
});

const { getSync, getDestination, updateSyncState, logSyncStart, logSyncFinish, setForceSyncFlag } = proxyActivities<
  ReturnType<typeof createActivities>
>({
  startToCloseTimeout: '10 second',
  retry: {
    maximumAttempts: 3,
  },
});

const { maybeSendSyncFinishWebhook } = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '6 minute',
  retry: {
    maximumAttempts: 3,
  },
});

export const RUN_MANAGED_SYNC_PREFIX = 'run-managed-sync-';
export const getRunManagedSyncScheduleId = (syncId: string): string => `${RUN_MANAGED_SYNC_PREFIX}${syncId}`;
export const getRunManagedSyncWorkflowId = (syncId: string): string => `${RUN_MANAGED_SYNC_PREFIX}${syncId}`;

export type RunManagedSyncArgs = {
  syncId: string;
  connectionId: string;
  category: ProviderCategory;
  context: Record<string, unknown>;
};

export async function runManagedSync({ syncId, connectionId, category }: RunManagedSyncArgs): Promise<void> {
  const { destination } = await getDestination({ connectionId });
  if (!destination) {
    return;
  }

  const historyIdsMap = Object.fromEntries(
    getCommonModels(category).map((commonModel) => {
      const entry: [CommonModelType, string] = [commonModel, uuid4()];
      return entry;
    })
  );

  await Promise.all(
    getCommonModels(category).map(async (commonModel) => {
      await logSyncStart({ syncId, historyId: historyIdsMap[commonModel], commonModel });
    })
  );

  // Read sync from DB
  const { sync } = await getSync({ syncId });

  let numRecordsSyncedMap: NumRecordsSyncedMap | undefined;
  try {
    // Figure out what to do based on sync strategy
    switch (sync.type) {
      case 'full then incremental':
        numRecordsSyncedMap = await doFullThenIncrementalSync({ sync, category });
        break;
      case 'full only':
        numRecordsSyncedMap = await doFullOnlySync({ sync, category });
        break;
      default:
        throw new Error('Sync type not supported.');
    }
  } catch (err: any) {
    const { message: errorMessage, stack: errorStack } = getErrorMessageStack(err);
    await Promise.all(
      getCommonModels(category).map(async (commonModel) => {
        await logSyncFinish({
          syncId,
          connectionId,
          historyId: historyIdsMap[commonModel],
          status: 'FAILURE',
          errorMessage,
          errorStack,
          numRecordsSynced: null,
        });
        await maybeSendSyncFinishWebhook({
          historyId: historyIdsMap[commonModel],
          status: 'SYNC_ERROR',
          connectionId,
          // TODO: This is potentially inaccurate. Maybe the activity should still return a result if it fails in the middle.
          numRecordsSynced: 0,
          commonModel,
          errorMessage,
        });
      })
    );

    throw err;
  }

  if (!numRecordsSyncedMap) {
    throw ApplicationFailure.nonRetryable('Unexpectedly numRecordsSyncedMap was not set');
  }

  await Promise.all(
    getCommonModels(category).map(async (commonModel) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore `numRecordsSyncedMap` is indeed defined here
      const numRecordsSynced = numRecordsSyncedMap[commonModel];

      await logSyncFinish({
        syncId,
        connectionId,
        historyId: historyIdsMap[commonModel],
        status: 'SUCCESS',
        numRecordsSynced,
      });
      await maybeSendSyncFinishWebhook({
        historyId: historyIdsMap[commonModel],
        status: 'SYNC_SUCCESS',
        connectionId,
        numRecordsSynced,
        commonModel,
      });
    })
  );
}

async function doFullOnlySync({
  sync,
  category,
}: {
  sync: FullOnlySync;
  category: ProviderCategory;
}): Promise<NumRecordsSyncedMap> {
  await updateSyncState({
    syncId: sync.id,
    state: {
      phase: 'full',
      status: 'in progress',
    },
  });

  const syncRecordsToDestinationResultList = Object.fromEntries(
    await Promise.all(
      getCommonModels(category).map(async (commonModel) => {
        const entry: [CommonModelType, SyncRecordsToDestinationResult] = [
          commonModel,
          await syncRecordsToDestination({ syncId: sync.id, connectionId: sync.connectionId, commonModel }),
        ];
        return entry;
      })
    )
  );

  await updateSyncState({
    syncId: sync.id,
    state: {
      phase: 'full',
      status: 'in progress',
    },
  });

  await updateSyncState({
    syncId: sync.id,
    state: {
      phase: 'full',
      status: 'done',
    },
  });

  return Object.fromEntries(
    getCommonModels(category).map((commonModel) => [
      commonModel,
      syncRecordsToDestinationResultList[commonModel].numRecordsSynced,
    ])
  ) as Record<CommonModelType, number>;
}

async function doFullThenIncrementalSync({
  sync,
  category,
}: {
  sync: FullThenIncrementalSync;
  category: ProviderCategory;
}): Promise<NumRecordsSyncedMap> {
  async function doFullStage(): Promise<NumRecordsSyncedMap> {
    await updateSyncState({
      syncId: sync.id,
      state: {
        phase: 'full',
        status: 'in progress',
        maxLastModifiedAtMsMap: getDefaultMaxLastModifiedAtMsMap(category),
      },
    });

    const syncRecordsToDestinationResultList = Object.fromEntries(
      await Promise.all(
        getCommonModels(category).map(async (commonModel) => {
          const entry: [CommonModelType, SyncRecordsToDestinationResult] = [
            commonModel,
            await syncRecordsToDestination({ syncId: sync.id, connectionId: sync.connectionId, commonModel }),
          ];
          return entry;
        })
      )
    );

    const newMaxLastModifiedAtMsMap =
      category === 'crm'
        ? {
            account: syncRecordsToDestinationResultList.account.maxLastModifiedAtMs,
            lead: syncRecordsToDestinationResultList.lead.maxLastModifiedAtMs,
            opportunity: syncRecordsToDestinationResultList.opportunity.maxLastModifiedAtMs,
            contact: syncRecordsToDestinationResultList.contact.maxLastModifiedAtMs,
            user: syncRecordsToDestinationResultList.user.maxLastModifiedAtMs,
          }
        : {
            contact: syncRecordsToDestinationResultList.contact.maxLastModifiedAtMs,
            user: syncRecordsToDestinationResultList.user.maxLastModifiedAtMs,
            sequence: syncRecordsToDestinationResultList.sequence.maxLastModifiedAtMs,
            mailbox: syncRecordsToDestinationResultList.mailbox.maxLastModifiedAtMs,
            sequence_state: syncRecordsToDestinationResultList.sequence_state.maxLastModifiedAtMs,
          };

    await updateSyncState({
      syncId: sync.id,
      state: {
        phase: 'full',
        status: 'in progress',
        maxLastModifiedAtMsMap: newMaxLastModifiedAtMsMap,
      },
    });

    await updateSyncState({
      syncId: sync.id,
      state: {
        phase: 'full',
        status: 'done',
        maxLastModifiedAtMsMap: newMaxLastModifiedAtMsMap,
      },
    });

    return Object.fromEntries(
      getCommonModels(category).map((commonModel) => [
        commonModel,
        syncRecordsToDestinationResultList[commonModel].numRecordsSynced,
      ])
    ) as Record<CommonModelType, number>;
  }

  async function doIncrementalPhase(): Promise<NumRecordsSyncedMap> {
    function getOriginalMaxLastModifiedAtMsMap(): NumRecordsSyncedMap {
      // TODO: we shouldn't need to do this, since it's not possible to
      // start the incremental phase if the full phase hasn't been completed.
      if (sync.state.phase === 'created') {
        return getDefaultMaxLastModifiedAtMsMap(category);
      }

      if (category === 'crm') {
        const maxLastModifiedAtMsMap = sync.state.maxLastModifiedAtMsMap as CRMNumRecordsSyncedMap;
        return {
          account: maxLastModifiedAtMsMap['account'] ?? 0,
          lead: maxLastModifiedAtMsMap['lead'] ?? 0,
          opportunity: maxLastModifiedAtMsMap['opportunity'] ?? 0,
          contact: maxLastModifiedAtMsMap['contact'] ?? 0,
          user: maxLastModifiedAtMsMap['user'] ?? 0,
        };
      }
      const maxLastModifiedAtMsMap = sync.state.maxLastModifiedAtMsMap as EngagementNumRecordsSyncedMap;
      return {
        contact: maxLastModifiedAtMsMap['contact'] ?? 0,
        user: maxLastModifiedAtMsMap['user'] ?? 0,
        sequence: maxLastModifiedAtMsMap['sequence'] ?? 0,
        mailbox: maxLastModifiedAtMsMap['mailbox'] ?? 0,
        sequence_state: maxLastModifiedAtMsMap['sequence_state'] ?? 0,
      };
    }

    function computeUpdatedMaxLastModifiedAtMsMap(
      syncRecordsToDestinationResultList:
        | Record<CRMCommonModelType, SyncRecordsToDestinationResult>
        | Record<EngagementCommonModelType, SyncRecordsToDestinationResult>
    ): NumRecordsSyncedMap {
      const originalMaxLastModifiedAtMsMap = getOriginalMaxLastModifiedAtMsMap();

      return Object.fromEntries(
        getCommonModels(category).map((commonModel) => [
          commonModel,
          Math.max(
            (originalMaxLastModifiedAtMsMap as Record<CommonModelType, number>)[commonModel],
            (syncRecordsToDestinationResultList as Record<CommonModelType, SyncRecordsToDestinationResult>)[commonModel]
              .maxLastModifiedAtMs
          ),
        ])
      ) as NumRecordsSyncedMap;
    }

    await updateSyncState({
      syncId: sync.id,
      state: {
        phase: 'incremental',
        status: 'in progress',
        maxLastModifiedAtMsMap: getOriginalMaxLastModifiedAtMsMap(),
      },
    });

    const syncRecordsToDestinationResultList = Object.fromEntries(
      await Promise.all(
        getCommonModels(category).map(async (commonModel) => {
          const entry: [CommonModelType, SyncRecordsToDestinationResult] = [
            commonModel,
            await syncRecordsToDestination({
              syncId: sync.id,
              connectionId: sync.connectionId,
              commonModel,
              updatedAfterMs: (getOriginalMaxLastModifiedAtMsMap() as Record<CommonModelType, number>)[commonModel],
            }),
          ];
          return entry;
        })
      )
    ) as Record<CommonModelType, SyncRecordsToDestinationResult>;

    const newMaxLastModifiedAtMsMap = computeUpdatedMaxLastModifiedAtMsMap(syncRecordsToDestinationResultList);

    // TODO: Bring this back when we fix https://github.com/supaglue-labs/supaglue/issues/644
    // await updateSyncState({
    //   syncId: sync.id,
    //   state: {
    //     phase: 'incremental',
    //     status: 'in progress',
    //     maxLastModifiedAtMsMap: newMaxLastModifiedAtMsMap,
    //   },
    // });

    await updateSyncState({
      syncId: sync.id,
      state: {
        phase: 'incremental',
        status: 'done',
        maxLastModifiedAtMsMap: newMaxLastModifiedAtMsMap,
      },
    });

    return Object.fromEntries(
      getCommonModels(category).map((commonModel) => [
        commonModel,
        (syncRecordsToDestinationResultList as Record<CommonModelType, SyncRecordsToDestinationResult>)[commonModel]
          .numRecordsSynced,
      ])
    ) as NumRecordsSyncedMap;
  }

  // Short circuit normal state transitions if we're forcing a sync which will reset the state
  if (sync.forceSyncFlag) {
    const results = await doFullStage();
    await setForceSyncFlag({ syncId: sync.id }, false);
    return results;
  }

  // Sync state transitions
  switch (sync.state.phase) {
    case 'created':
      return await doFullStage();
    case 'full':
      switch (sync.state.status) {
        case 'in progress':
          return await doFullStage();
        case 'done':
          return await doIncrementalPhase();
      }
      break;
    case 'incremental':
      return await doIncrementalPhase();
  }
}

const getDefaultMaxLastModifiedAtMsMap = (category: ProviderCategory): NumRecordsSyncedMap => {
  if (category === 'crm') {
    return {
      account: 0,
      lead: 0,
      opportunity: 0,
      contact: 0,
      user: 0,
    };
  }
  return {
    contact: 0,
    user: 0,
    sequence: 0,
    mailbox: 0,
    sequence_state: 0,
  };
};

const getErrorMessageStack = (err: Error): { message: string; stack: string } => {
  if (err instanceof ActivityFailure) {
    return {
      message: err.failure?.cause?.message ?? 'Unknown error',
      stack: err.failure?.cause?.stackTrace ?? 'No proto stack',
    };
  }
  if (err instanceof ApplicationFailure) {
    return { message: err.failure?.message ?? 'Unknown error', stack: err.failure?.stackTrace ?? 'No proto stack' };
  }
  return { message: err.message ?? 'Unknown error', stack: err.stack ?? 'No stack' };
};

const getCommonModels = (category: ProviderCategory) =>
  category === 'crm' ? CRM_COMMON_MODEL_TYPES : ENGAGEMENT_COMMON_MODEL_TYPES;
