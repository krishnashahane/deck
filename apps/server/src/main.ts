import { ConfigError, loadConfig, type Config } from './config';
import { createDeckServer } from './app';

let cfg: Config;
try {
  cfg = loadConfig();
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  console.error(`DECK will not start: ${e.message}. See docs/DEPLOYMENT.md.`);
  process.exit(1);
}
const s = await createDeckServer(cfg);
s.server.listen(cfg.port, () => console.log(`DECK server on http://localhost:${cfg.port} (${cfg.production ? 'production' : 'development'}; AI: ${cfg.ai.provider})`));
const stop = async () => {
  await s.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
