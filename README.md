


## UI update
The `public/` app was redesigned as a premium monochrome PNR control dashboard using the supplied railway design assets, while the existing backend/API/monitoring flow remains unchanged.

## V5 UI + automatic monitoring completion

The V5 interface uses a premium boarding-pass route visualization with the provided train-side asset. The top notification bell has been removed because email is the app's notification channel.

Monitoring now completes automatically when one of these terminal conditions is detected:
- the latest passenger status is confirmed (CNF / Confirmed)
- the provider reports the railway chart as prepared
- the journey date has arrived or passed

For a terminal status change, the status-change email is sent first. The PNR is only marked inactive after the email succeeds, so a failed email does not silently stop monitoring. Chart-prepared events without a status movement receive a final completion email before monitoring is stopped. When the journey date is reached without a new status movement, monitoring is stopped without sending an unnecessary duplicate email.

Run `server/supabase-v5-migration.sql` once in Supabase SQL Editor to add route and monitoring-completion metadata for existing projects. The backend contains fallbacks for the older schema, but route information for existing PNRs will only persist after the migration has been applied.


## V13 performance update
The dashboard now loads its active PNRs and history through a single `/api/dashboard` request instead of making one history request per PNR. Initial page loading no longer waits for external API route hydration; missing route data is filled in the background. Large railway PNG assets used by the UI were converted to WebP for substantially smaller downloads, and static assets receive browser caching headers.

Real monitoring remains hourly through the existing `/api/monitor/run` endpoint and cron scheduler.
