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
app.use(express.static(path.join(__dirname, "../client")));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    providerEnabled: process.env.PNR_PROVIDER_ENABLED === "true",
    time: new Date().toISOString()
  });
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

  res.json({ success: true, pnrs: data });
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

    const { data, error } = await supabase
      .from("pnrs")
      .insert({
        pnr_number: pnrNumber,
        email,
        train_number: result.trainNumber,
        train_name: result.trainName,
        journey_date: result.journeyDate,
        previous_status: null,
        current_status: result.currentStatus,
        last_checked_at: new Date().toISOString()
      })
      .select()
      .single();

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

  const { error } = await supabase
    .from("pnrs")
    .update({ active: false })
    .eq("id", id);

  if (error) {
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

  res.json({ success: true, history: data });
});

app.post("/api/monitor/run", async (req, res) => {
  try {
    await checkAllPNRs();
    res.json({
      success: true,
      message: "Monitoring check completed."
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`PNR Monitor running at http://localhost:${PORT}`);
});

