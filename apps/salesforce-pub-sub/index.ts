import { getCoreDependencyContainer } from '@supaglue/core';
import { logger } from '@supaglue/core/lib/logger';
import { CDCWebhookPayload } from '@supaglue/types/cdc';
import * as jsforce from 'jsforce';
import { createClient } from './client';
import { ReplayPreset } from './gen/pubsub_api_pb';

const EVENT_TYPES_TO_SUBSCRIBE_TO = [
  'AccountChangeEvent',
  'ContactChangeEvent',
  'LeadChangeEvent',
  'OpportunityChangeEvent',
  'EventChangeEvent',
  'UserChangeEvent',
];

const { connectionService, integrationService, webhookService, applicationService } = getCoreDependencyContainer();
(async () => {
  logger.info('Starting Salesforce CDC worker');
  const connections = await connectionService.listAllUnsafe({ providerName: 'salesforce' });

  for (const connection of connections) {
    const application = await applicationService.getById(connection.applicationId);

    const {
      credentials: { instanceUrl, refreshToken, loginUrl = 'https://login.salesforce.com' },
      id: connectionId,
    } = connection;

    const integration = await integrationService.getById(connection.integrationId);

    let conn: jsforce.Connection;
    try {
      conn = new jsforce.Connection({
        oauth2: new jsforce.OAuth2({
          loginUrl,
          clientId: integration.config.oauth.credentials.oauthClientId,
          clientSecret: integration.config.oauth.credentials.oauthClientSecret,
        }),
        instanceUrl,
        refreshToken,
        maxRequest: 10,
      });

      const salesforceEdition = (await conn.query('select OrganizationType from Organization')).records[0]
        ?.OrganizationType;
      if (
        salesforceEdition !== 'Developer Edition' &&
        salesforceEdition !== 'Unlimited Edition' &&
        salesforceEdition !== 'Enterprise Edition' &&
        salesforceEdition !== 'Base Edition' // AKA Performance Edition
      ) {
        logger.warn(
          {
            salesforceEdition,
            connectionId,
            applicationId: connection.applicationId,
            integrationId: connection.integrationId,
          },
          'Unsupported Salesforce edition, skipping'
        );
        continue;
      }
    } catch (err: any) {
      logger.error(
        { err, connectionId, applicationId: connection.applicationId, integrationId: connection.integrationId },
        "couldn't connect to salesforce due to error, skipping"
      );
      continue;
    }

    const processStream = async (eventType: string) => {
      let replayId: Uint8Array | undefined;
      let replayPreset = ReplayPreset.LATEST;
      // make sure we have the latest accessToken
      // we also get the instanceurl here since the one on the connection is sometimes incorrect.
      // TODO we should fix this in the connection service
      const { access_token: accessToken, instance_url: instanceUrl } = await conn.oauth2.refreshToken(refreshToken);
      // expiresAt is not returned from the refresh token response
      await connectionService.updateConnectionWithNewAccessToken(connectionId, accessToken, /* expiresAt */ null);

      // get the latest recorded replayId, if any
      const encodedReplayId = await webhookService.getReplayId(connectionId, eventType);
      if (encodedReplayId) {
        replayId = Uint8Array.from(Buffer.from(encodedReplayId, 'base64'));
        replayPreset = ReplayPreset.CUSTOM;
      }

      const { organization_id } = await conn.identity();
      const tenantId = `core/${new URL(instanceUrl).hostname.split('.')[0]}/${organization_id}`;
      const client = await createClient({
        accessToken,
        instanceUrl,
        tenantId,
      });

      logger.info(
        {
          connectionId,
          applicationId: connection.applicationId,
          integrationId: connection.integrationId,
          eventType,
        },
        'starting stream'
      );

      const stream = client.subscribe({
        topicName: `/data/${eventType}`,
        replayPreset,
        replayId,
        numRequested: 100,
      });
      for await (const { event, latestReplayId } of stream) {
        const { ChangeEventHeader, ...fields } = event;
        const { changeType, nulledFields, changedFields, diffFields, recordIds, entityName, transactionKey } =
          ChangeEventHeader;
        // skip gap events for now, since consumers wouldn't be able to do anything with them
        if (
          changeType === 'GAP_CREATE' ||
          changeType === 'GAP_DELETE' ||
          changeType === 'GAP_UPDATE' ||
          changeType === 'GAP_UNDELETE' ||
          changeType === 'GAP_OVERFLOW'
        ) {
          logger.info(
            {
              changeType,
              connectionId,
              applicationId: connection.applicationId,
              integrationId: connection.integrationId,
              eventType,
            },
            'skipping gap event'
          );
          continue;
        }
        for (const recordId of recordIds) {
          const webhookPayload: CDCWebhookPayload = {
            id: recordId,
            nulledFields,
            changedFields,
            diffFields,
            fields,
          };

          const eventName = `${entityName.toLowerCase()}.${changeType.toLowerCase()}`;

          await webhookService.sendMessage(eventName, webhookPayload, application, `${transactionKey}-${recordId}`);

          logger.debug(
            {
              webhookPayload,
              connectionId,
              applicationId: connection.applicationId,
              integrationId: connection.integrationId,
              eventType,
            },
            'sent webhook'
          );
        }

        await webhookService.saveReplayId(connectionId, eventType, Buffer.from(latestReplayId).toString('base64'));
      }
    };

    const subscribe = async (eventType: string) => {
      const streamErrorHandler = async (err: any) => {
        // TODO probably should do something a bit more sophisticated here
        if (
          err.message.startsWith('[not_found]') ||
          err.message.startsWith('[unauthenticated]') ||
          err.message.startsWith('[permission_denied]') ||
          err.message === 'expired access/refresh token'
        ) {
          logger.error(
            {
              err,
              connectionId,
              applicationId: connection.applicationId,
              integrationId: connection.integrationId,
              eventType,
            },
            'unrecoverable error starting stream, skipping'
          );
          return;
        }

        logger.warn(
          {
            err,
            connectionId,
            applicationId: connection.applicationId,
            integrationId: connection.integrationId,
            eventType,
          },
          'error in stream, restarting'
        );
        await processStream(eventType).catch(streamErrorHandler);
      };

      await processStream(eventType).catch(streamErrorHandler);
    };

    EVENT_TYPES_TO_SUBSCRIBE_TO.forEach(async (eventType) => subscribe(eventType));
  }
})().catch((error) => {
  logger.error(error, 'error caught in main');
  process.exit(1);
});
