# MemoriWA — WhatsApp Document Intelligence

Self-hosted dashboard that turns one WhatsApp number into a smart document
inbox. Connect a number via QR scan and every document (PDF, DOCX, XLSX,
PPTX, TXT, CSV) or photo sent to it appears in a live dashboard — with
search, statistics, AI analysis and an activity-photo documentation flow.

## Install with one line (Ubuntu/Debian VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/KaryaPutraS/memoriwa/main/install.sh | bash
```

The script installs Docker if missing, downloads this repo, generates all
secrets, builds and starts three containers (`waha`, `api`, `web`), then
prints your dashboard URL and admin password. Done in ±3 minutes.

**Non-interactive** (automation friendly):

```bash
curl -fsSL https://raw.githubusercontent.com/KaryaPutraS/memoriwa/main/install.sh \
  | bash -s -- --domain dash.example.com --port 80 -y
```

**Update an existing install:** just run the same one-liner again — your
`.env`, WhatsApp session and document data are preserved.

## After installing

1. Open the dashboard URL and log in.
2. Go to **Settings → Connect** and scan the QR code with the WhatsApp
   number that will receive documents.
3. Send documents from any other number — they appear in the Inbox live.

### Activity photo flow

Send one or more photos, then one text message afterwards: the text
becomes the explanation and groups that photo burst in the Inbox.
Click **Verify** to file them (no AI needed). A caption sent together
with the photos works the same way.

## Manual install

```bash
git clone https://github.com/KaryaPutraS/memoriwa.git
cd memoriwa
cp .env.example .env   # fill in real values (openssl rand -hex 32)
docker compose up -d --build
```

### Configuration (.env)

| Variable | Description |
|---|---|
| `PUBLIC_URL` | Public URL of the dashboard, e.g. `http://dash.example.com` |
| `WEB_PORT` | Host port for the dashboard (default 80) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Dashboard login |
| `JWT_SECRET` | Session signing secret (32+ chars) |
| `WEBHOOK_SECRET` | Shared secret protecting the WAHA webhook |
| `WAHA_API_KEY` | API key shared with the WAHA service |
| `GROQ_API_KEY` | Optional fallback AI key for OCR/analysis |
| `CAPTION_BURST_GAP_SEC` | Max gap between photos of one burst (default 120) |

## Manage

```bash
cd ~/memoriwa
docker compose logs -f     # follow logs
docker compose down        # stop
docker compose up -d       # start
```

## Security

- JWT login (12 h), login rate limiting, PBKDF2-hashed password
- Webhook shared-secret, WebSocket origin+token validation, SSRF guard
- API keys for AI providers stored Fernet-encrypted
- Only the web port is exposed; `api` and `waha` stay inside the docker network

## Development

```bash
# Backend tests (32 tests)
cd backend && pip install -r requirements.txt && pytest -q

# Frontend dev server
cd frontend && npm install && npm run dev
```

Backend dev stack alone (api + waha on localhost): `cd backend && docker compose up -d --build`
