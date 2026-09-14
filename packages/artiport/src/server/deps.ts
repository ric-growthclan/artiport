import { authFromEnv } from './auth';
import type { HandlerDeps } from './handlers';
import { storeFromEnv } from './store-env';

export const envDeps: HandlerDeps = {
  store: () => storeFromEnv(),
  auth: () => authFromEnv(),
};
