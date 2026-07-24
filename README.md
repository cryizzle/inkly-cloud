# inkly-cloud

Private server-backed version of ink.ly, the writing, reading, and reward tracker.

## Local Development

```sh
npm install
npm run dev
```

By default, local development does not require an access token unless `INKLY_ACCESS_TOKEN` is set.

## Token Access

When `INKLY_ACCESS_TOKEN` is configured, every non-public route is protected.

Browser/PWA access:

```text
https://your-inkly-host.example/?token=your-token
```

The server stores the token in an HTTP-only cookie and removes it from the URL.

API access:

```sh
curl -H "Authorization: Bearer your-token" https://your-inkly-host.example/api/summary
```

`X-Inkly-Token: your-token` is also accepted.

## Docker

Create an environment file:

```sh
cp .env.example .env
```

Set a private token in `.env`:

```text
INKLY_ACCESS_TOKEN=replace-with-a-long-random-token
ORIGIN=https://your-inkly-host.example
```

Run the app:

```sh
docker compose up --build
```

The app listens on `http://localhost:3000` by default.

SQLite data is stored in the Docker volume `inkly-cloud-data`, mounted at `/data` inside the container.

## Runtime Environment

Useful variables:

```text
PORT=3000
ORIGIN=https://your-inkly-host.example
INKLY_ACCESS_TOKEN=replace-with-a-long-random-token
INKLY_DATA_DIR=/data
INKLY_RESOURCES_DIR=/app/resources
INKLY_TRUSTED_ORIGINS=
INKLY_ALLOW_NO_TOKEN=
```

Seed CSVs are bundled in `resources/seed` and used only when the database is first initialized.
