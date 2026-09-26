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

const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir, {
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(?:css|js|svg|png|jpe?g|webp)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=604800");
    }
  }
}));

// API responses must always be fresh because PNR status is live data.
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

function isMissingV5ColumnError(error) {
  return Boolean(
    error &&
    /from_station_|to_station_|chart_prepared|monitor_stop_reason|monitor_stopped_at|schema cache|Could not find the/i.test(
      error.message || ""
    )
  );
}

function meaningfulHistory(items) {
  return (Array.isArray(items) ? items : []).filter(item => {
    const oldStatus = String(item.old_status || "").replace(/\s+/g, " ").trim().toUpperCase();
    const newStatus = String(item.new_status || "").replace(/\s+/g, " ").trim().toUpperCase();
    return Boolean(newStatus) && (!oldStatus || oldStatus !== newStatus);
  });
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
    .update({
      active: false,
      monitor_stop_reason: reason,
      monitor_stopped_at: new Date().toISOString()
    })
    .eq("id", id);

  if (!error) return;
  if (!isMissingV5ColumnError(error)) throw error;

  const { error: fallbackError } = await supabase
    .from("pnrs")
    .update({ active: false })
    .eq("id", id);

  if (fallbackError) throw fallbackError;
}

async function updateRoute(pnrId, result) {
  const routePayload = {
    from_station_name: result.fromStation?.name || null,
    from_station_code: result.fromStation?.code || null,
    to_station_name: result.toStation?.name || null,
    to_station_code: result.toStation?.code || null
  };

  const { error } = await supabase
    .from("pnrs")
    .update(routePayload)
    .eq("id", pnrId);

  if (error && !isMissingV5ColumnError(error)) throw error;
  return routePayload;
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    providerEnabled: process.env.PNR_PROVIDER_ENABLED === "true",
    time: new Date().toISOString()
  });
});

/*
 * Fast dashboard payload:
 * - 1 browser request instead of /pnrs + N history requests + /history
 * - active PNR query and global history query run in parallel
 * - no live API Mitra calls are made during initial page load
 */
app.get("/api/dashboard", async (req, res) => {
  try {
    const [pnrResult, historyResult] = await Promise.all([
      supabase
        .from("pnrs")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false }),

      supabase
        .from("status_history")
        .select("id,pnr_id,old_status,new_status,checked_at")
        .order("checked_at", { ascending: false })
        .limit(200)
    ]);

    if (pnrResult.error) throw new Error(`Database error: ${pnrResult.error.message}`);
    if (historyResult.error) throw new Error(`History error: ${historyResult.error.message}`);

    const pnrs = pnrResult.data || [];
    const recentHistory = meaningfulHistory(historyResult.data || []);

    // Enrich recent history with minimal PNR metadata in a single query.
    const historyPnrIds = [...new Set(recentHistory.map(item => item.pnr_id).filter(Boolean))];

    let historyPNRs = [];
    if (historyPnrIds.length) {
      const historyPnrResult = await supabase
        .from("pnrs")
        .select("id,pnr_number,train_number,train_name,journey_date,active,monitor_stop_reason,monitor_stopped_at")
        .in("id", historyPnrIds);

      if (historyPnrResult.error) {
        if (!isMissingV5ColumnError(historyPnrResult.error)) {
          throw new Error(`PNR history metadata error: ${historyPnrResult.error.message}`);
        }

        const fallback = await supabase
          .from("pnrs")
          .select("id,pnr_number,train_number,train_name,journey_date,active")
          .in("id", historyPnrIds);

        if (fallback.error) {
          throw new Error(`PNR history metadata error: ${fallback.error.message}`);
        }
        historyPNRs = fallback.data || [];
      } else {
        historyPNRs = historyPnrResult.data || [];
      }
    }

    const historyPNRMap = new Map(historyPNRs.map(pnr => [String(pnr.id), pnr]));
    const historyRecords = recentHistory
      .map(item => ({
        ...item,
        pnr: historyPNRMap.get(String(item.pnr_id)) || null
      }))
      .filter(item => item.pnr);

    // Build inline history from the same global response.
    // If a PNR's older initial event isn't inside the global 200 rows,
    // we simply keep the most recent meaningful events available.
    const histories = {};
    for (const pnr of pnrs) histories[String(pnr.id)] = [];

    for (const item of meaningfulHistory(historyResult.data || [])) {
      if (!histories[String(item.pnr_id)]) continue;
      histories[String(item.pnr_id)].push(item);
    }

    Object.keys(histories).forEach(id => {
      histories[id] = histories[id]
        .sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at))
        .slice(0, 6);
    });

    const routeMissingIds = pnrs
      .filter(pnr => !pnr.from_station_name && !pnr.from_station_code && !pnr.to_station_name && !pnr.to_station_code)
      .map(pnr => pnr.id);

    res.json({
      success: true,
      providerEnabled: process.env.PNR_PROVIDER_ENABLED === "true",
      time: new Date().toISOString(),
      pnrs,
      histories,
      historyRecords,
      routeMissingIds
    });
  } catch (error) {
    console.error("[API] Dashboard:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/pnrs", async (req, res) => {
  const { data, error } = await supabase
    .from("pnrs")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({ success: true, pnrs: data || [] });
});

app.post("/api/pnrs/:id/refresh-route", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: pnr, error } = await supabase
      .from("pnrs")
      .select("id,pnr_number,active")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ success: false, error: "PNR not found." });
    if (!pnr.active) return res.status(400).json({ success: false, error: "PNR monitoring is no longer active." });

    const result = await checkPNR(pnr.pnr_number);
    const route = await updateRoute(id, result);

    res.json({ success: true, route });
  } catch (error) {
    console.error("[API] Refresh route:", error);
    res.status(500).json({ success: false, error: error.message });
  }
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

    const { error: historyError } = await supabase.from("status_history").insert({
      pnr_id: data.id,
      old_status: null,
      new_status: result.currentStatus
    });

    if (historyError) {
      console.error(`[API] Initial history save: ${historyError.message}`);
    }

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
    .select("id,pnr_id,old_status,new_status,checked_at")
    .eq("pnr_id", id)
    .order("checked_at", { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({
    success: true,
    history: meaningfulHistory(data || [])
  });
});

app.get("/api/history", async (req, res) => {
  try {
    const { data: history, error: historyError } = await supabase
      .from("status_history")
      .select("id,pnr_id,old_status,new_status,checked_at")
      .order("checked_at", { ascending: false })
      .limit(200);

    if (historyError) throw historyError;

    const meaningful = meaningfulHistory(history || []);
    const ids = [...new Set(meaningful.map(item => item.pnr_id).filter(Boolean))];

    if (!ids.length) return res.json({ success: true, history: [] });

    const { data: pnrs, error: pnrError } = await supabase
      .from("pnrs")
      .select("id,pnr_number,train_number,train_name,journey_date,active,monitor_stop_reason,monitor_stopped_at")
      .in("id", ids);

    if (pnrError) {
      if (!isMissingV5ColumnError(pnrError)) throw pnrError;

      const fallback = await supabase
        .from("pnrs")
        .select("id,pnr_number,train_number,train_name,journey_date,active")
        .in("id", ids);

      if (fallback.error) throw fallback.error;

      return res.json({
        success: true,
        history: meaningful.map(item => ({
          ...item,
          pnr: (fallback.data || []).find(p => p.id === item.pnr_id) || null
        })).filter(item => item.pnr)
      });
    }

    res.json({
      success: true,
      history: meaningful.map(item => ({
        ...item,
        pnr: (pnrs || []).find(p => p.id === item.pnr_id) || null
      })).filter(item => item.pnr)
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
