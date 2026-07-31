#!/bin/sh
set -e

python manage.py migrate --noinput

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-4}" \
  --threads "${WEB_THREADS:-2}" \
  --timeout 60 \
  --access-logfile - \
  --error-logfile -
