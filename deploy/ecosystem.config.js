// PM2 process manager config — runs the Node backend in cluster mode across
// all available CPU cores, restarting any worker that crashes. This is the
// realistic form of "load balancing" on a single VPS: multiple Node processes
// sharing the load, with PM2 round-robining requests between them.
//
// Usage (on the server, after `npm ci --omit=dev` and `npm run build`):
//   pm2 start deploy/ecosystem.config.js --env production
//   pm2 save
//   pm2 startup   # follow the printed instructions to survive reboots
//
// Requires JWT_SECRET, CORS_ORIGIN, and NODE_ENV=production set in the
// environment (see .env.example) — the server refuses to boot without a real
// JWT_SECRET when NODE_ENV=production.

module.exports = {
  apps: [
    {
      name: 'gurushishyaru-api',
      script: 'server/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env_production: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
