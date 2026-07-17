# Deployment (single VPS)

Do this only after you've rotated the VPS root password (or, better, switched to SSH-key auth and disabled password login entirely).

## 1. Server prerequisites

```bash
# As a non-root sudo user (create one if you're currently only using root):
sudo apt update && sudo apt install -y nginx sqlite3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Deploy the app

```bash
git clone <your-repo-url> /var/www/gurushishyaru
cd /var/www/gurushishyaru
npm ci
npm run build            # produces dist/
cp .env.example .env
# Edit .env: set JWT_SECRET (openssl rand -base64 32), CORS_ORIGIN, NODE_ENV=production
mkdir -p logs
pm2 start deploy/ecosystem.config.js --env production
pm2 save
pm2 startup               # follow the printed command to enable on boot
```

## 3. nginx + HTTPS

```bash
sudo cp deploy/proxy_params_gurushishyaru /etc/nginx/proxy_params_gurushishyaru
sudo cp deploy/nginx.conf /etc/nginx/sites-available/gurushishyaru
# Edit server_name and the dist/ root path in that file to match your domain/path
sudo ln -s /etc/nginx/sites-available/gurushishyaru /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo certbot --nginx -d your-domain.com   # installs the SSL cert + rewrites the config
sudo systemctl reload nginx
```

## 4. Ongoing

- **Backups**: the app's own Backup & Restore page (super_admin only) creates a downloadable zip of the database + uploads on demand. Consider a cron job hitting `POST /api/backup/create` on a schedule and copying the result off-box (a single VPS is a single point of failure).
- **Updates**: `git pull && npm ci && npm run build && pm2 restart gurushishyaru-api`.
- **Logs**: `pm2 logs gurushishyaru-api`.
- **WhatsApp OTP**: parent login now requires a working WhatsApp send path (see System Settings in-app). If `enable_whatsapp` is off, parents cannot log in — verify this is enabled and using real Meta credentials before going live, not the Mock provider.
