require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const supabase = require("./database");
const { checkPNR } = require("./pnrService");
const { checkAllPNRs } = require("./monitor");

const app = express();

app.disable("x-powered-by");

app.use(cors());
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "../public")));

function isMissingV5ColumnError(error) {
  return Boolean(error && /from_station_|to_station_|chart_prepared|monitor_stop_reason|monitor_stopped_at|schema cache|Could not find the/i.test(error.message || ""));
}

async function insertPNR(payload) {
  const { data, error } = await supabase
    .from("pnrs")
    .insert(payload)
    .select()
    .single();

  if (!error) return { data, error: null };

  if (!isMissingV5ColumnError(error)) return { data: null, error };

  const fallback = { ...payload };
  delete fallback.from_station_name;
  delete fallback.from_station_code;
  delete fallback.to_station_name;
  delete fallback.to_station_code;
  delete fallback.chart_prepared;

  return supabase
    .from("pnrs")
    .insert(fallback)
    .select()
    .single();
}

async function stopPNR(id, reason = "manual") {
  const { error } = await supabase
    .from("pnrs")
    .update({ active: false, monitor_stop_reason: reason, monitor_stopped_at: new Date().toISOString() })
    .eq("id", id);

  if (!error) return;
  if (!isMissingV5ColumnError(error)) throw error;

  const { error: fallbackError } = await supabase
    .from("pnrs")
    .update({ active: false })
    .eq("id", id);

  if (fallbackError) throw fallbackError;
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    providerEnabled: process.env.PNR_PROVIDER_ENABLED === "true",
    time: new Date().toISOString()
  });
});

async function hydrateMissingRoutes(pnrs) {
  const source = Array.isArray(pnrs) ? pnrs : [];

  return Promise.all(source.map(async (pnr) => {
    const hasRoute = Boolean(
      pnr.from_station_name ||
      pnr.from_station_code ||
      pnr.to_station_name ||
      pnr.to_station_code
    );

    if (hasRoute || !pnr.pnr_number) return pnr;

    try {
      const result = await checkPNR(pnr.pnr_number);
      const fromStation = result.fromStation || null;
      const toStation = result.toStation || null;

      if (!fromStation && !toStation) return pnr;

      const enriched = {
        ...pnr,
        from_station_name: fromStation?.name || pnr.from_station_name || null,
        from_station_code: fromStation?.code || pnr.from_station_code || null,
        to_station_name: toStation?.name || pnr.to_station_name || null,
        to_station_code: toStation?.code || pnr.to_station_code || null
      };

      // Persist route fields when the optional V5 columns exist. If the user
      // has not applied the migration, keep the enriched route in the API
      // response so the current UI still shows the real route.
      const { error: routeUpdateError } = await supabase
        .from("pnrs")
        .update({
          from_station_name: enriched.from_station_name,
          from_station_code: enriched.from_station_code,
          to_station_name: enriched.to_station_name,
          to_station_code: enriched.to_station_code
        })
        .eq("id", pnr.id);

      if (routeUpdateError && !isMissingV5ColumnError(routeUpdateError)) {
        console.warn(`[ROUTE] Could not persist route for ${pnr.pnr_number}: ${routeUpdateError.message}`);
      }

      return enriched;
    } catch (error) {
      console.warn(`[ROUTE] Could not hydrate ${pnr.pnr_number}: ${error.message}`);
      return pnr;
    }
  }));
}

app.get("/api/pnrs", async (req, res) => {
  const { data, error } = await supabase
    .from("pnrs")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const enrichedPNRs = await hydrateMissingRoutes(data || []);
  res.json({ success: true, pnrs: enrichedPNRs });
});

app.post("/api/pnrs", async (req, res) => {
  try {
    const pnrNumber = String(req.body.pnrNumber || "").trim();
    const email = String(req.body.email || "").trim();

    if (!/^\d{10}$/.test(pnrNumber)) {
      return res.status(400).json({
        success: false,
        error: "PNR must contain exactly 10 digits."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Enter a valid email address."
      });
    }

    const { count, error: countError } = await supabase
      .from("pnrs")
      .select("*", { count: "exact", head: true })
      .eq("active", true);

    if (countError) throw countError;

    if (count >= 10) {
      return res.status(400).json({
        success: false,
        error: "Maximum of 10 active PNRs reached."
      });
    }

    const result = await checkPNR(pnrNumber);

    const { data, error } = await insertPNR({
      pnr_number: pnrNumber,
      email,
      train_number: result.trainNumber,
      train_name: result.trainName,
      journey_date: result.journeyDate,
      from_station_name: result.fromStation?.name || null,
      from_station_code: result.fromStation?.code || null,
      to_station_name: result.toStation?.name || null,
      to_station_code: result.toStation?.code || null,
      chart_prepared: result.chartPrepared === true,
      previous_status: null,
      current_status: result.currentStatus,
      last_checked_at: new Date().toISOString()
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    await supabase.from("status_history").insert({
      pnr_id: data.id,
      old_status: null,
      new_status: result.currentStatus
    });

    res.status(201).json({ success: true, pnr: data });
  } catch (error) {
    console.error("[API] Add PNR:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete("/api/pnrs/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await stopPNR(id, "manual");
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({
    success: true,
    message: "PNR monitoring stopped."
  });
});

app.get("/api/pnrs/:id/history", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("status_history")
    .select("*")
    .eq("pnr_id", id)
    .order("checked_at", { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const meaningfulHistory = (data || []).filter(item => !item.old_status || item.old_status !== item.new_status);
  res.json({ success: true, history: meaningfulHistory });
});

app.get("/api/history", async (req, res) => {
  try {
    const { data: history, error: historyError } = await supabase
      .from("status_history")
      .select("*")
      .order("checked_at", { ascending: false })
      .limit(200);

    if (historyError) throw historyError;

    // History is meant to represent meaningful events: the initial state
    // and real status changes. Older versions stored every hourly check,
    // including unchanged statuses, so filter those legacy duplicates here.
    const meaningfulHistory = (history || []).filter(item => !item.old_status || item.old_status !== item.new_status);

    const ids = [...new Set(meaningfulHistory.map(item => item.pnr_id).filter(Boolean))];
    if (!ids.length) return res.json({ success: true, history: [] });

    const { data: pnrs, error: pnrError } = await supabase
      .from("pnrs")
      .select("id,pnr_number,train_number,train_name,journey_date,active,monitor_stop_reason,monitor_stopped_at")
      .in("id", ids);

    if (pnrError) {
      // Keep the endpoint compatible with the older schema if the optional
      // v5 completion metadata columns have not been migrated yet.
      if (!isMissingV5ColumnError(pnrError)) throw pnrError;
      const fallback = await supabase
        .from("pnrs")
        .select("id,pnr_number,train_number,train_name,journey_date,active")
        .in("id", ids);
      if (fallback.error) throw fallback.error;
      return res.json({
        success: true,
        history: meaningfulHistory.map(item => ({ ...item, pnr: (fallback.data || []).find(p => p.id === item.pnr_id) || null }))
      });
    }

    res.json({
      success: true,
      history: meaningfulHistory.map(item => ({ ...item, pnr: (pnrs || []).find(p => p.id === item.pnr_id) || null }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/monitor/run", async (req, res) => {
  try {
    const monitorSecret = process.env.MONITOR_SECRET;
    const suppliedSecret = req.get("X-Monitor-Secret");

    if (!monitorSecret) {
      console.error("[MONITOR] MONITOR_SECRET is not configured.");
      return res.status(500).json({
        success: false,
        error: "Monitor secret is not configured."
      });
    }

    if (suppliedSecret !== monitorSecret) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized."
      });
    }

    await checkAllPNRs();

    res.json({
      success: true,
      message: "Monitoring check completed."
    });
  } catch (error) {
    console.error("[API] Monitor:", error);

    res.status(500).json({
      success: false,
      error: "Monitoring check failed."
    });
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PNR Monitor running at http://localhost:${PORT}`);
  });
}

module.exports = app;

