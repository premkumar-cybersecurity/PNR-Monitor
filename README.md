# PNR Monitor

A small PNR monitoring website that tracks up to 10 active railway PNRs and sends an email when a status changes.

## Production architecture

- **Render Web Service** — serves the dashboard and API.
- **Render Cron Job** — runs the PNR check once every hour.
- **Supabase** — stores active PNRs and status history.
- **API Mitra** — provides the current PNR status.
- **Resend** — sends status-change emails.

The web service does **not** run an in-process hourly scheduler. This avoids duplicate or missed checks when a web service is restarted or put to sleep. Render Cron runs `npm run monitor` once per hour instead. Render cron schedules use UTC.

## Features

- Add up to 10 active PNRs
- Store current status and status history in Supabase
- Hourly status checks through a dedicated cron job
- Detect status changes
- Polished HTML email notifications
- Manual `POST /api/monitor/run` check for testing
- Simple responsive dashboard
- Email-only notifications (no SMS gateway)

## Local setup

1. Copy `.env.example` to `.env`.
2. Create the Supabase tables using `server/supabase.sql`.
3. Add your Supabase URL and service-role key to `.env`.
4. Add your PNR provider credentials.
5. Add your Resend API key.
6. Install dependencies:

```bash
npm install
```

7. Start the local web server:

```bash
npm start
```

Open `http://localhost:3000`.

For a manual monitor run in another terminal:

```bash
npm run monitor
```

## Deploy with Render

The repository includes `render.yaml` for a Web Service plus an hourly Cron Job.

1. Push this project to GitHub.
2. In Render, create a **Blueprint** from the repository, or create the Web Service and Cron Job manually using the settings in `render.yaml`.
3. Add the secret environment variables in Render's Environment settings.
4. Do **not** commit `.env` or any API keys. Render supports adding environment variables/secrets in the dashboard.
5. After the Web Service gets its `onrender.com` URL, set `APP_URL` to that URL and redeploy.
6. Test the Web Service's `/api/health` endpoint.
7. Manually trigger the Cron Job once from Render to verify the first production check.

### Render schedule

```text
0 * * * *
```

This runs at minute 0 of every hour in **UTC**. Render cron jobs use UTC for schedules.

## Email notifications

Email is sent through Resend using the `RESEND_API_KEY` environment variable. The sender defaults to `onboarding@resend.dev` for testing. For a long-term production sender, configure a verified sending domain in Resend and set `RESEND_FROM` accordingly.

## Security

- Never put the Supabase service-role key in frontend code.
- Never commit `.env`.
- Keep all provider/API credentials in Render environment variables.
- The current dashboard is intentionally small and does not include user authentication. Do not expose it publicly until you add authentication or another access-control layer if multiple users could reach it.
