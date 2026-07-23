# Guru Shishyaru Tutorials — deployment

Single production VPS, shared with a few other unrelated sites (ayuktha.in, rishithareddy.in, svstittamadu.in) — don't touch those.

- **Host**: `gurushishyaru-vps` (SSH alias in `~/.ssh/config`, key-only auth — root password login is disabled). Underlying IP/key are local machine config, not repo secrets.
- **App dir**: `/var/www/gurushishyaru.in` (git checkout of this repo's `main` branch, owned by `www-data`)
- **Backend**: `server/server.js` run as systemd service `gurushishyaru` (port 4000). Env vars (JWT_SECRET, Brevo SMTP creds, CORS_ORIGIN) live in the systemd unit at `/etc/systemd/system/gurushishyaru.service` on the VPS, not in a checked-out `.env`.
- **Frontend**: `npm run build` output (`dist/`) served directly by nginx.
- **nginx site**: `/etc/nginx/sites-available/gurushishyaru.in`, TLS via certbot.

## Deploying a change

The VPS pulls from GitHub — it never receives code straight from a dev machine. So:

```bash
git push origin main
./scripts/deploy.sh
```

`scripts/deploy.sh` SSHes in, hard-resets the VPS checkout to `origin/main`, runs `npm ci && npm run build`, and restarts the `gurushishyaru` systemd service.

When asked to "deploy" or "push the latest changes live," run those two steps after committing.

## Credentials

Never store VPS passwords, SSH private keys, or the systemd unit's secrets (JWT_SECRET, Brevo SMTP password) in this repo or in this file — this file is tracked by git. Deploy access is via the `gurushishyaru-vps` SSH key on the local machine only.
