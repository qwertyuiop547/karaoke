# Multi-stage: Vite frontend + Django/Gunicorn API (serves SPA)
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install
COPY frontend/ ./
# Same-origin API when served by Django; display price for Offline Pass UI
ENV VITE_API_URL=/api
ENV VITE_OFFLINE_PASS_PRICE="₱149"
ENV VITE_OFFLINE_PASS_PERIOD="/mo"
ENV VITE_OFFLINE_PASS_LABEL="Offline Pass · ₱149/mo"
ARG VITE_GOOGLE_CLIENT_ID=1041809515809-on1uu7s1mevgu4ppnjpi7nrsk0opj94u.apps.googleusercontent.com
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend /fe/dist /app/frontend_dist

RUN chmod +x /app/entrypoint.sh \
    && python manage.py collectstatic --noinput

EXPOSE 8000

ENTRYPOINT ["sh", "/app/entrypoint.sh"]
