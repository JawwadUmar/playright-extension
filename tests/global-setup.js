import { startServer } from './server.mjs';

export default async function setup() {
  const server = await startServer();
  return async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
}
