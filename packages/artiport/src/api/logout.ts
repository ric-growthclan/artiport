import { handleLogout } from '../server/handlers';

export function POST(request: Request): Promise<Response> {
  return handleLogout(request);
}
