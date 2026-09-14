import { envDeps } from '../server/deps';
import { handleSession } from '../server/handlers';

export function GET(request: Request): Promise<Response> {
  return handleSession(request, envDeps);
}
