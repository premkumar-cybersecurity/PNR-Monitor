const supabase = require("./database");
const { checkPNR } = require("./pnrService");
const { notifyStatusChange } = require("./notifier");

async function checkAllPNRs() {
  console.log(`[MONITOR] ${new Date().toISOString()} - starting check`);

  const { data: pnrs, error } = await supabase
    .from("pnrs")
    .select("*")
    .eq("active", true)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

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

      const commonUpdate = {
        train_number: result.trainNumber,
        train_name: result.trainName,
        journey_date: result.journeyDate,
        last_checked_at: new Date().toISOString()
      };

      if (!oldStatus) {
        const { error: updateError } = await supabase
          .from("pnrs")
          .update({
            ...commonUpdate,
            current_status: newStatus,
            previous_status: null
          })
          .eq("id", pnr.id);

        if (updateError) throw updateError;

        await supabase.from("status_history").insert({
          pnr_id: pnr.id,
          old_status: null,
          new_status: newStatus
        });

        console.log(`[MONITOR] Initial status: ${newStatus}`);
        continue;
      }

      if (oldStatus !== newStatus) {
        const { error: historyError } = await supabase
          .from("status_history")
          .insert({
            pnr_id: pnr.id,
            old_status: oldStatus,
            new_status: newStatus
          });

        if (historyError) throw historyError;

        const { error: updateError } = await supabase
          .from("pnrs")
          .update({
            ...commonUpdate,
            previous_status: oldStatus,
            current_status: newStatus
          })
          .eq("id", pnr.id);

        if (updateError) throw updateError;

        await notifyStatusChange({
          ...pnr,
          train_number: result.trainNumber,
          train_name: result.trainName,
          journey_date: result.journeyDate
        }, oldStatus, newStatus);

        console.log(`[MONITOR] ${oldStatus} -> ${newStatus}`);
      } else {
        const { error: updateError } = await supabase
          .from("pnrs")
          .update(commonUpdate)
          .eq("id", pnr.id);

        if (updateError) throw updateError;

        console.log(`[MONITOR] No change: ${newStatus}`);
      }
    } catch (error) {
      console.error(`[MONITOR] ${pnr.pnr_number}: ${error.message}`);
    }
  }
}

module.exports = { checkAllPNRs };
