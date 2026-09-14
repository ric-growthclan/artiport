import { envDeps } from '../server/deps';
import { handleLogin } from '../server/handlers';

export function POST(request: Request): Promise<Response> {
  return handleLogin(request, envDeps);
}
