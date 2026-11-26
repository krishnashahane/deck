import { loadConfig } from './config';
import { createDeckServer } from './app';

const cfg = loadConfig();
const s = await createDeckServer(cfg);
s.server.listen(cfg.port, () => console.log(`DECK server on http://localhost:${cfg.port} (${cfg.production ? 'production' : 'development'}; AI: ${cfg.ai.provider})`));
const stop = async () => {
  await s.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
