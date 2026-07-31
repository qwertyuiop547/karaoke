#!/bin/sh
set -e

python manage.py migrate --noinput

# Fresh Postgres starts empty — load Platinum catalog once.
python manage.py seed_songs --if-empty

WORKERS="${WEB_CONCURRENCY:-1}"
THREADS="${WEB_THREADS:-2}"

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "$WORKERS" \
  --threads "$THREADS" \
  --timeout 120 \
  --graceful-timeout 30 \
  --keep-alive 5 \
  --access-logfile - \
  --error-logfile -
