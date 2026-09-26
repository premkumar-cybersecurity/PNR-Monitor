const supabase = require("./database");
const { checkPNR } = require("./pnrService");
const { notifyStatusChange, notifyChartPrepared } = require("./notifier");

function getISTDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function isConfirmed(status) {
  const value = String(status || "").toUpperCase();
  return value.includes("CNF") || value.includes("CONFIRMED");
}

function isChartPrepared(result, status) {
  const value = String(status || "").toUpperCase();
  return result.chartPrepared === true || value.includes("CHART PREPARED");
}

function isJourneyDateReached(journeyDate) {
  if (!journeyDate) return false;
  return String(journeyDate) <= getISTDateString();
}

function normalizeStatus(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

async function updateCoreIfCurrentMatches(pnrId, expectedStatus, update) {
  const core = {
    train_number: update.train_number,
    train_name: update.train_name,
    journey_date: update.journey_date,
    previous_status: update.previous_status ?? null,
    current_status: update.current_status,
    last_checked_at: update.last_checked_at
  };

  const { data, error } = await supabase
    .from("pnrs")
    .update(core)
    .eq("id", pnrId)
    .eq("current_status", expectedStatus)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

function getTerminalReason(result, status) {
  if (isConfirmed(status)) return "confirmed";
  if (isChartPrepared(result, status)) return "chart-prepared";
  if (isJourneyDateReached(result.journeyDate)) return "journey-date";
  return null;
}

async function markInactive(pnrId, reason) {
  const payload = { active: false };

  // These fields are part of the v5 schema. If the user has not run the
  // optional migration yet, fall back to the existing active flag.
  payload.monitor_stop_reason = reason;
  payload.monitor_stopped_at = new Date().toISOString();

  const { error } = await supabase
    .from("pnrs")
    .update(payload)
    .eq("id", pnrId);

  if (!error) return;

  if (/monitor_stop_reason|monitor_stopped_at|schema cache|Could not find the/i.test(error.message || "")) {
    const { error: fallbackError } = await supabase
      .from("pnrs")
      .update({ active: false })
      .eq("id", pnrId);
    if (fallbackError) throw fallbackError;
    return;
  }

  throw error;
}

async function updatePNR(pnrId, update) {
  const extended = {
    ...update,
    from_station_name: update.fromStation?.name || null,
    from_station_code: update.fromStation?.code || null,
    to_station_name: update.toStation?.name || null,
    to_station_code: update.toStation?.code || null,
    chart_prepared: update.chartPrepared === true
  };
  delete extended.fromStation;
  delete extended.toStation;

  const { error } = await supabase.from("pnrs").update(extended).eq("id", pnrId);
  if (!error) return;

  if (/from_station_|to_station_|chart_prepared|schema cache|Could not find the/i.test(error.message || "")) {
    const fallback = { ...update };
    delete fallback.fromStation;
    delete fallback.toStation;
    delete fallback.chartPrepared;
    const { error: fallbackError } = await supabase.from("pnrs").update(fallback).eq("id", pnrId);
    if (fallbackError) throw fallbackError;
    return;
  }

  throw error;
}

async function checkAllPNRs() {
  console.log(`[MONITOR] ${new Date().toISOString()} - starting check`);

  const { data: pnrs, error } = await supabase
    .from("pnrs")
    .select("*")
    .eq("active", true)
    .order("id", { ascending: true });

  if (error) throw new Error(`Database error: ${error.message}`);

  if (!pnrs.length) {
    console.log("[MONITOR] No active PNRs.");
    return;
  }

  for (const pnr of pnrs) {
    try {
      console.log(`[MONITOR] Checking ${pnr.pnr_number}...`);

      const result = await checkPNR(pnr.pnr_number);
      const newStatus = result.currentStatus;
      const oldStatus = pnr.current_status;
      const terminalReason = getTerminalReason(result, newStatus);

      const commonUpdate = {
        train_number: result.trainNumber,
        train_name: result.trainName,
        journey_date: result.journeyDate,
        fromStation: result.fromStation,
        toStation: result.toStation,
        chartPrepared: result.chartPrepared,
        last_checked_at: new Date().toISOString()
      };

      if (!oldStatus) {
        await updatePNR(pnr.id, {
          ...commonUpdate,
          current_status: newStatus,
          previous_status: null
        });

        await supabase.from("status_history").insert({
          pnr_id: pnr.id,
          old_status: null,
          new_status: newStatus
        });

        if (terminalReason === "confirmed") {
          await notifyStatusChange({ ...pnr, ...result }, null, newStatus, { completed: true, reason: terminalReason });
          await markInactive(pnr.id, terminalReason);
          console.log(`[MONITOR] Initial status ${newStatus}; monitoring completed (${terminalReason}).`);
        } else if (terminalReason === "chart-prepared") {
          await notifyChartPrepared({ ...pnr, ...result });
          await markInactive(pnr.id, terminalReason);
          console.log(`[MONITOR] Initial status ${newStatus}; chart prepared, monitoring completed.`);
        } else if (terminalReason === "journey-date") {
          await markInactive(pnr.id, terminalReason);
          console.log(`[MONITOR] Initial status ${newStatus}; journey date reached, monitoring completed.`);
        } else {
          console.log(`[MONITOR] Initial status: ${newStatus}`);
        }
        continue;
      }

      const statusChanged = normalizeStatus(oldStatus) !== normalizeStatus(newStatus);

      if (statusChanged) {
        // Compare-and-set prevents duplicate emails when two scheduler calls
        // overlap and both read the same previous status. Only the first call
        // that still sees the expected current_status is allowed to continue.
        const claimed = await updateCoreIfCurrentMatches(pnr.id, oldStatus, {
          ...commonUpdate,
          previous_status: oldStatus,
          current_status: newStatus
        });

        if (!claimed) {
          console.log(`[MONITOR] Skipped ${pnr.pnr_number}: status was already updated by another run.`);
          continue;
        }

        const { error: historyError } = await supabase
          .from("status_history")
          .insert({
            pnr_id: pnr.id,
            old_status: oldStatus,
            new_status: newStatus
          });

        if (historyError) {
          console.error(`[MONITOR] History save failed for ${pnr.pnr_number}: ${historyError.message}`);
        }

        // Persist optional route/chart fields after the compare-and-set.
        await updatePNR(pnr.id, commonUpdate);

        await notifyStatusChange(
          { ...pnr, ...result },
          oldStatus,
          newStatus,
          terminalReason ? { completed: true, reason: terminalReason } : {}
        );

        if (terminalReason) {
          await markInactive(pnr.id, terminalReason);
          console.log(`[MONITOR] ${oldStatus} -> ${newStatus}; monitoring completed (${terminalReason}).`);
        } else {
          console.log(`[MONITOR] ${oldStatus} -> ${newStatus}`);
        }
      } else if (terminalReason === "chart-prepared") {
        await updatePNR(pnr.id, commonUpdate);
        await notifyChartPrepared({ ...pnr, ...result });
        await markInactive(pnr.id, terminalReason);
        console.log(`[MONITOR] No status change; chart prepared, monitoring completed.`);
      } else if (terminalReason === "confirmed") {
        await updatePNR(pnr.id, commonUpdate);
        await notifyStatusChange(
          { ...pnr, ...result },
          oldStatus,
          newStatus,
          { completed: true, reason: terminalReason }
        );
        await markInactive(pnr.id, terminalReason);
        console.log(`[MONITOR] Status remains ${newStatus}; confirmed, monitoring completed.`);
      } else if (terminalReason === "journey-date") {
        await updatePNR(pnr.id, commonUpdate);
        await markInactive(pnr.id, terminalReason);
        console.log(`[MONITOR] No change: ${newStatus}; journey date reached, monitoring completed.`);
      } else {
        await updatePNR(pnr.id, commonUpdate);
        console.log(`[MONITOR] No change: ${newStatus}`);
      }
    } catch (error) {
      console.error(`[MONITOR] ${pnr.pnr_number}: ${error.message}`);
    }
  }
}

module.exports = { checkAllPNRs };
