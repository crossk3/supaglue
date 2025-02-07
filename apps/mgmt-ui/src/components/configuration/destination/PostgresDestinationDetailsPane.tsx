/* eslint-disable @typescript-eslint/no-floating-promises */
import { createDestination, updateDestination } from '@/client';
import Spinner from '@/components/Spinner';
import { useNotification } from '@/context/notification';
import { useActiveApplicationId } from '@/hooks/useActiveApplicationId';
import { useDestinations } from '@/hooks/useDestinations';
import getIcon from '@/utils/companyToIcon';
import { Button, Stack, TextField, Typography } from '@mui/material';
import Card from '@mui/material/Card';
import { Destination } from '@supaglue/types';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { postgresDestinationCardInfo } from './DestinationTabPanelContainer';

export type PostgresDestinationDetailsPanelProps = {
  isLoading: boolean;
};

export default function PostgresDestinationDetailsPanel({ isLoading }: PostgresDestinationDetailsPanelProps) {
  const activeApplicationId = useActiveApplicationId();
  const { addNotification } = useNotification();

  const { destinations: existingDestinations = [], mutate } = useDestinations();

  const destination = existingDestinations.find((existingDestination) => existingDestination.type === 'postgres');

  const [host, setHost] = useState<string>('');
  const [port, setPort] = useState<number>(5432);
  const [database, setDatabase] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [schema, setSchema] = useState<string>('');
  const [user, setUser] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    if (destination?.type !== 'postgres') {
      return;
    }

    setHost(destination.config.host);
    setName(destination.name);
    setPort(destination.config.port);
    setDatabase(destination.config.database);
    setSchema(destination.config.schema);
    setUser(destination.config.user);
    setPassword(destination.config.password);
  }, [destination?.id]);

  const createOrUpdateDestination = async (): Promise<Destination> => {
    if (destination) {
      return await updateDestination({
        ...destination,
        type: 'postgres',
        name,
        config: {
          host,
          port,
          schema,
          database,
          user,
          password,
        },
      });
    }
    return await createDestination({
      applicationId: activeApplicationId,
      type: 'postgres',
      name,
      config: {
        host,
        port,
        database,
        schema,
        user,
        password,
      },
    });
  };

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <Card>
      <Stack direction="column" className="gap-4" sx={{ padding: '2rem' }}>
        <Stack direction="row" className="items-center justify-between w-full">
          <Stack direction="row" className="items-center justify-center gap-2">
            {getIcon(postgresDestinationCardInfo.type, 35)}
            <Stack direction="column">
              <Typography variant="subtitle1">{postgresDestinationCardInfo.name}</Typography>
            </Stack>
          </Stack>
        </Stack>

        <Stack className="gap-2">
          <Typography variant="subtitle1">Destination Name</Typography>
          <TextField
            value={name}
            size="small"
            label="Name (must be unique)"
            variant="outlined"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setName(event.target.value);
            }}
          />
        </Stack>

        <Stack className="gap-2">
          <Typography variant="subtitle1">Host</Typography>
          <TextField
            value={host}
            size="small"
            label="Host"
            variant="outlined"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setHost(event.target.value);
            }}
          />
        </Stack>

        <Stack className="gap-2">
          <Typography variant="subtitle1">Port</Typography>
          <TextField
            value={port}
            size="small"
            label="Port"
            variant="outlined"
            type="number"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setPort(parseInt(event.target.value, 10));
            }}
          />
        </Stack>

        <Stack className="gap-2">
          <Typography variant="subtitle1">Database</Typography>
          <TextField
            value={database}
            size="small"
            label="Database"
            variant="outlined"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setDatabase(event.target.value);
            }}
          />
        </Stack>

        <Stack className="gap-2">
          <Typography variant="subtitle1">Schema</Typography>
          <TextField
            value={schema}
            size="small"
            label="Schema"
            variant="outlined"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSchema(event.target.value);
            }}
          />
        </Stack>

        <Stack className="gap-2">
          <Typography variant="subtitle1">Credentials</Typography>
          <TextField
            value={user}
            size="small"
            label="User"
            variant="outlined"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setUser(event.target.value);
            }}
          />
          <TextField
            value={password}
            size="small"
            label="Password"
            variant="outlined"
            type="password"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setPassword(event.target.value);
            }}
          />
        </Stack>

        <Stack direction="row" className="gap-2 justify-between">
          <Stack direction="row" className="gap-2">
            <Button
              variant="outlined"
              onClick={() => {
                router.back();
              }}
            >
              Back
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                const newDestination = await createOrUpdateDestination();
                addNotification({ message: 'Successfully updated destination', severity: 'success' });
                const latestDestinations = [
                  ...existingDestinations.filter(({ id }) => id !== newDestination.id),
                  newDestination,
                ];
                mutate(latestDestinations, {
                  optimisticData: latestDestinations,
                  revalidate: false,
                  populateCache: false,
                });
              }}
            >
              Save
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Card>
  );
}
