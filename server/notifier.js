const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL =
  process.env.RESEND_FROM || "PNR Monitor <onboarding@resend.dev>";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeStatus(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function formatJourneyDate(date) {
  if (!date) return "Not available";

  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(date);

  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  });
}

function formatCheckedTime(date = new Date()) {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata"
  });
}

function terminalMessage(reason) {
  switch (reason) {
    case "confirmed":
      return "Your PNR reached a confirmed status, so automatic monitoring has now been stopped.";
    case "chart-prepared":
      return "The chart is prepared, so automatic monitoring has now been stopped.";
    case "journey-date":
      return "The journey date has been reached, so automatic monitoring has now been stopped.";
    default:
      return "Automatic monitoring for this PNR has now been stopped.";
  }
}

async function sendEmail({ pnr, oldStatus, newStatus, subject, title, subtitle, message }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  // Final safety guard: a status-change email must never be sent when the
  // normalized previous and current statuses are identical.
  if (oldStatus !== undefined && normalizeStatus(oldStatus) === normalizeStatus(newStatus)) {
    console.warn(`[NOTIFIER] Skipped duplicate status email for ${pnr?.pnr_number || "unknown PNR"}.`);
    return { skipped: true };
  }

  const journeyDate = formatJourneyDate(pnr.journey_date);
  const appUrl = process.env.APP_URL || "";

  const buttonHtml = appUrl
    ? `
      <a href="${escapeHtml(appUrl)}"
         style="display:inline-block;padding:13px 22px;background:#111111;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
        Open PNR Monitor
      </a>
    `
    : "";

  // Deliberately use stacked blocks rather than a flex row. This is far more
  // reliable in Gmail/mobile mail clients and prevents clipped status text.
  const statusBlock = oldStatus !== undefined
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e5e5;border-radius:12px;margin:0 0 22px 0;">
        <tr>
          <td style="padding:20px;">
            <div style="font-size:13px;line-height:18px;font-weight:700;color:#171717;margin-bottom:14px;">↔ Status Changed</div>

            <div style="background:#f5f5f5;border-radius:10px;padding:15px;overflow-wrap:anywhere;word-break:break-word;">
              <div style="font-size:10px;line-height:15px;color:#777777;margin-bottom:6px;letter-spacing:.08em;font-weight:700;">PREVIOUS STATUS</div>
              <div style="font-size:17px;line-height:23px;color:#171717;font-weight:700;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(oldStatus || "Initial")}</div>
            </div>

            <div style="text-align:center;padding:8px 0;color:#777777;font-size:20px;line-height:20px;">↓</div>

            <div style="background:#111111;border-radius:10px;padding:15px;overflow-wrap:anywhere;word-break:break-word;">
              <div style="font-size:10px;line-height:15px;color:#aaaaaa;margin-bottom:6px;letter-spacing:.08em;font-weight:700;">CURRENT STATUS</div>
              <div style="font-size:17px;line-height:23px;color:#ffffff;font-weight:700;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(newStatus || "Not available")}</div>
            </div>
          </td>
        </tr>
      </table>
    `
    : "";

  const fromStation = pnr.from_station?.name || pnr.from_station?.code || pnr.from_station_name || pnr.from_station_code;
  const toStation = pnr.to_station?.name || pnr.to_station?.code || pnr.to_station_name || pnr.to_station_code;
  const routeHtml = fromStation || toStation
    ? `
      <tr>
        <td style="padding:8px 0;color:#777777;vertical-align:top;width:36%;">Route</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;line-height:20px;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(fromStation || "—")} <span style="color:#999999;">→</span> ${escapeHtml(toStation || "—")}</td>
      </tr>
    `
    : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-shell { width:100% !important; border-radius:0 !important; }
      .email-pad { padding:20px !important; }
      .email-header { padding:22px 20px !important; }
      .email-title { font-size:23px !important; line-height:29px !important; }
      .email-subtitle { font-size:13px !important; line-height:20px !important; }
      .pnr-number { font-size:21px !important; }
      .journey-table td { font-size:13px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eeeeee;font-family:Arial,Helvetica,sans-serif;color:#171717;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eeeeee;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <table role="presentation" class="email-shell" width="620" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dddddd;">
          <tr>
            <td class="email-header" style="background:#111111;padding:28px 30px;color:#ffffff;">
              <div style="font-size:12px;line-height:16px;letter-spacing:1.7px;font-weight:700;color:#bdbdbd;">PNR MONITOR</div>
              <div class="email-title" style="margin-top:10px;font-size:26px;line-height:32px;font-weight:700;">${escapeHtml(title)}</div>
              <div class="email-subtitle" style="margin-top:7px;font-size:14px;line-height:21px;color:#cccccc;">${escapeHtml(subtitle)}</div>
            </td>
          </tr>

          <tr>
            <td class="email-pad" style="padding:30px;">
              <div style="background:#f7f7f7;border-radius:12px;padding:18px;margin-bottom:20px;">
                <div style="font-size:10px;line-height:15px;color:#777777;letter-spacing:1px;font-weight:700;">PNR NUMBER</div>
                <div class="pnr-number" style="margin-top:6px;font-size:23px;line-height:29px;font-weight:700;letter-spacing:1px;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(pnr.pnr_number)}</div>
              </div>

              ${statusBlock}

              <div style="border-top:1px solid #eeeeee;padding-top:20px;">
                <div style="font-size:13px;line-height:18px;font-weight:700;margin-bottom:12px;">Journey Details</div>
                <table class="journey-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:14px;">
                  <tr>
                    <td style="padding:8px 0;color:#777777;vertical-align:top;width:36%;">Train</td>
                    <td style="padding:8px 0;text-align:right;font-weight:600;line-height:20px;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(pnr.train_number || "Not available")}${pnr.train_name ? ` — ${escapeHtml(pnr.train_name)}` : ""}</td>
                  </tr>
                  ${routeHtml}
                  <tr>
                    <td style="padding:8px 0;color:#777777;vertical-align:top;">Journey Date</td>
                    <td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(journeyDate)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#777777;vertical-align:top;">Checked At</td>
                    <td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(formatCheckedTime())}</td>
                  </tr>
                </table>
              </div>

              <div style="margin-top:22px;background:#f7f7f7;border-radius:10px;padding:18px;font-size:14px;line-height:21px;color:#555555;overflow-wrap:anywhere;word-break:break-word;">
                <strong style="color:#171717;">${escapeHtml(message)}</strong>
              </div>

              ${buttonHtml ? `<div style="margin-top:25px;text-align:center;">${buttonHtml}</div>` : ""}
            </td>
          </tr>

          <tr>
            <td style="border-top:1px solid #eeeeee;padding:20px 30px;text-align:center;font-size:12px;line-height:18px;color:#999999;">PNR Monitor<br>Automatic status notification</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: [pnr.email],
    subject,
    html
  });

  if (result.error) throw new Error(result.error.message);

  console.log(`[NOTIFIER] Email sent to ${pnr.email}`);
  return { skipped: false };
}

async function notifyStatusChange(pnr, oldStatus, newStatus, options = {}) {
  const completed = Boolean(options.completed);

  if (oldStatus !== undefined && normalizeStatus(oldStatus) === normalizeStatus(newStatus)) {
    console.warn(`[NOTIFIER] Refusing unchanged status email for ${pnr.pnr_number}.`);
    return { skipped: true };
  }

  const subject = completed
    ? `🚆 PNR ${pnr.pnr_number} — ${formatJourneyDate(pnr.journey_date)} — Status Updated — Monitoring Complete`
    : `🚆 PNR ${pnr.pnr_number} — ${formatJourneyDate(pnr.journey_date)} — Status Updated`;

  return sendEmail({
    pnr,
    oldStatus,
    newStatus,
    subject,
    title: completed ? "Status Update · Monitoring Complete" : "Status Update",
    subtitle: completed ? "Your journey reached a monitoring completion point." : "Your PNR status has changed.",
    message: completed
      ? terminalMessage(options.reason)
      : "Monitoring continues. You'll receive another email whenever the booking status changes."
  });
}

async function notifyChartPrepared(pnr) {
  return sendEmail({
    pnr,
    oldStatus: undefined,
    newStatus: undefined,
    subject: `🚆 PNR ${pnr.pnr_number} — ${formatJourneyDate(pnr.journey_date)} — Chart Prepared — Monitoring Complete`,
    title: "Chart Prepared · Monitoring Complete",
    subtitle: "The railway chart is prepared for this journey.",
    message: terminalMessage("chart-prepared")
  });
}

module.exports = {
  notifyStatusChange,
  notifyChartPrepared
};
