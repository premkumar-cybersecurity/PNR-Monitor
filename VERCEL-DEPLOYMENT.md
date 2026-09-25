# Vercel deployment

This project uses an Express backend with a static frontend.

- `server.js` at the project root is the Vercel Express entry point.
- `public/` contains the frontend so Vercel can serve static files through its CDN.
- The local/Render start command remains `node server/server.js`.
- Environment variables must be configured in Vercel; `.env` is intentionally ignored.

## Monitoring schedule

The existing `render.yaml` keeps the hourly monitoring worker on Render. Vercel Hobby cron jobs are limited to once per day, so an hourly monitor should not be configured as a Vercel Hobby cron job.
