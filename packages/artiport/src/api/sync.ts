import { envDeps } from '../server/deps';
import { handleSync } from '../server/handlers';

export function POST(request: Request): Promise<Response> {
  return handleSync(request, envDeps);
}
