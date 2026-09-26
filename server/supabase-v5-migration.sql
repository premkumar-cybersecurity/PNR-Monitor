-- PNR Monitor v5: route data + automatic monitoring completion metadata.
-- Run this once in Supabase SQL Editor.

ALTER TABLE public.pnrs
  ADD COLUMN IF NOT EXISTS from_station_name text,
  ADD COLUMN IF NOT EXISTS from_station_code text,
  ADD COLUMN IF NOT EXISTS to_station_name text,
  ADD COLUMN IF NOT EXISTS to_station_code text,
  ADD COLUMN IF NOT EXISTS chart_prepared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monitor_stop_reason text,
  ADD COLUMN IF NOT EXISTS monitor_stopped_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pnrs_monitor_stop_reason
ON public.pnrs(monitor_stop_reason);
