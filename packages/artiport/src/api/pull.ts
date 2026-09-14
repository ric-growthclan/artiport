import { envDeps } from '../server/deps';
import { handlePull } from '../server/handlers';

export function POST(request: Request): Promise<Response> {
  return handlePull(request, envDeps);
}
