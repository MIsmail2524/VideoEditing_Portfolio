'use strict';

const { load } = require('./src/config');
const { createApp } = require('./src/app');
const { ensureAdminFromEnv } = require('./scripts/create-admin');

async function main() {
  const config = load();
  if (config.isProduction && !config.siteUrl) {
    // Without a fixed public URL, canonical links and the CSRF origin check would trust the Host header.
    throw new Error('SITE_URL must be set in production (e.g. SITE_URL=https://www.example.com).');
  }
  const app = createApp(config);
  await ensureAdminFromEnv(app.locals.db);

  const server = app.listen(config.port, config.host, () => {
    console.log(`Portfolio running on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`Admin panel: /admin`);
    if (!config.cookieSecure) console.warn('[warn] COOKIE_SECURE is off. Enable it (and HTTPS) in production.');
  });

  server.headersTimeout = 60 * 1000;
  server.requestTimeout = 60 * 60 * 1000; // large uploads on slow connections
  server.keepAliveTimeout = 5 * 1000;

  const shutdown = () => {
    server.close(() => {
      app.locals.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
