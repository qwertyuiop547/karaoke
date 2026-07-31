# Platinum Karaoke Songbook

Search Official Platinum Karaoke song numbers (React + Django + SQLite/Postgres).

## Quick start (local / SQLite)

```powershell
# 1) Backend
.\.venv\Scripts\Activate.ps1
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_songs
python manage.py runserver

# 2) Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

Admin login: use your staff account (create with `python manage.py createsuperuser` if needed).

## Database

| Mode | When |
|---|---|
| **SQLite (default)** | Local / venue laptop. Set `USE_SQLITE=true` in `.env`. |
| **Postgres + Redis (scale)** | For thousands of concurrent users. See below. |

## Scale mode (~5k concurrent users)

Topology: **Postgres + Redis + Gunicorn (≥4 workers)**. Presence heartbeats stay in Redis (no DB write per ping). Song list responses are cached ~20s.

```powershell
# Start Postgres + Redis + API
docker compose up -d --build

# API: http://localhost:8000
# Then run the Vite frontend as usual (proxied /api → :8000 if configured)
```

Or run the API on the host against compose Postgres/Redis:

```powershell
# .env
USE_SQLITE=false
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
REDIS_URL=redis://localhost:6379/0
CONN_MAX_AGE=60

cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_songs
gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 4 --threads 2
```

Expected shape for ~5k concurrent songbook users:

- 1× Postgres 16
- 1× Redis 7
- ≥4 Gunicorn workers (or multiple web replicas behind a reverse proxy)
- Static frontend on CDN / Vite preview / nginx

### Quick load smoke (optional)

With the API up:

```powershell
# Install hey: https://github.com/rakyll/hey
hey -n 2000 -c 50 "http://127.0.0.1:8000/api/songs/?page=1&page_size=10"
hey -n 1000 -c 50 -m POST -H "Content-Type: application/json" -d "{\"visitor_key\":\"loadtestkey123\",\"path\":\"songbook\"}" "http://127.0.0.1:8000/api/presence/ping/"
```

## Catalog refresh

```powershell
# Rebuild CSV from Platinum PDFs (optional)
python scripts/build_platinum_catalog.py

# Load into DB (reads backend/songs/data/platinum_songs.csv)
cd backend
python manage.py seed_songs
# or replace all rows:
python manage.py seed_songs --replace
```

## Security notes

- Never leave `DJANGO_DEBUG=true` or a weak `DJANGO_SECRET_KEY` in production.
- Change the admin password from Control Room → **Password**.
- Login, reports, presence pings, and public song GETs are rate-limited (shared via Redis in scale mode).
- All DB access goes through the Django ORM (parameterized queries). There is no raw SQL. Filters/search are length-capped and whitelisted where applicable.

## Tests

```powershell
cd backend
python manage.py test songs
```
