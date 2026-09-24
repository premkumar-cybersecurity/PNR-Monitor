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

function formatJourneyDate(date) {
  if (!date) return "Not available";

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return escapeHtml(date);
  }

  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
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
    timeZone: "Asia/Kolkata",
  });
}

async function notifyStatusChange(pnr, oldStatus, newStatus) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const journeyDate = formatJourneyDate(pnr.journey_date);

  const subject = `🚆 PNR ${pnr.pnr_number} — ${journeyDate} — Status Updated`;

  const appUrl = process.env.APP_URL || "";

  const buttonHtml = appUrl
    ? `
      <a href="${escapeHtml(appUrl)}"
         style="
           display:inline-block;
           padding:13px 22px;
           background:#111111;
           color:#ffffff;
           text-decoration:none;
           border-radius:8px;
           font-size:14px;
           font-weight:600;
         ">
        Open PNR Monitor
      </a>
    `
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PNR Status Update</title>
</head>

<body style="
  margin:0;
  padding:0;
  background:#f4f4f4;
  font-family:Arial,Helvetica,sans-serif;
  color:#171717;
">

  <div style="
    max-width:620px;
    margin:30px auto;
    background:#ffffff;
    border-radius:16px;
    overflow:hidden;
    border:1px solid #e5e5e5;
  ">

    <!-- Header -->
    <div style="
      background:#111111;
      padding:28px 30px;
      color:#ffffff;
    ">

      <div style="
        font-size:13px;
        letter-spacing:1.5px;
        font-weight:700;
        opacity:0.75;
      ">
        🚆 PNR MONITOR
      </div>

      <div style="
        margin-top:10px;
        font-size:26px;
        font-weight:700;
      ">
        Status Update
      </div>

      <div style="
        margin-top:7px;
        font-size:14px;
        color:#cccccc;
      ">
        Your PNR status has changed.
      </div>

    </div>

    <!-- Main content -->
    <div style="padding:30px;">

      <!-- PNR -->
      <div style="
        background:#f7f7f7;
        border-radius:12px;
        padding:18px;
        margin-bottom:20px;
      ">

        <div style="
          font-size:11px;
          color:#777777;
          letter-spacing:1px;
          font-weight:700;
        ">
          PNR NUMBER
        </div>

        <div style="
          margin-top:6px;
          font-size:22px;
          font-weight:700;
          letter-spacing:1px;
        ">
          ${escapeHtml(pnr.pnr_number)}
        </div>

      </div>

      <!-- Status Change -->
      <div style="
        border:1px solid #e5e5e5;
        border-radius:12px;
        padding:20px;
        margin-bottom:22px;
      ">

        <div style="
          font-size:13px;
          font-weight:700;
          margin-bottom:15px;
        ">
          🔄 Status Changed
        </div>

        <div style="
          display:flex;
          align-items:center;
          gap:12px;
          flex-wrap:wrap;
        ">

          <div style="
            flex:1;
            min-width:180px;
            background:#f5f5f5;
            border-radius:10px;
            padding:15px;
          ">

            <div style="
              font-size:11px;
              color:#777777;
              margin-bottom:6px;
            ">
              PREVIOUS STATUS
            </div>

            <div style="
              font-size:17px;
              font-weight:700;
            ">
              ${escapeHtml(oldStatus || "Initial")}
            </div>

          </div>

          <div style="
            font-size:22px;
            color:#777777;
          ">
            →
          </div>

          <div style="
            flex:1;
            min-width:180px;
            background:#111111;
            color:#ffffff;
            border-radius:10px;
            padding:15px;
          ">

            <div style="
              font-size:11px;
              color:#aaaaaa;
              margin-bottom:6px;
            ">
              CURRENT STATUS
            </div>

            <div style="
              font-size:17px;
              font-weight:700;
            ">
              ${escapeHtml(newStatus)}
            </div>

          </div>

        </div>

      </div>

      <!-- Journey Details -->
      <div style="
        border-top:1px solid #eeeeee;
        padding-top:20px;
      ">

        <div style="
          font-size:13px;
          font-weight:700;
          margin-bottom:15px;
        ">
          Journey Details
        </div>

        <table style="
          width:100%;
          border-collapse:collapse;
          font-size:14px;
        ">

          <tr>
            <td style="
              padding:8px 0;
              color:#777777;
            ">
              Train
            </td>

            <td style="
              padding:8px 0;
              text-align:right;
              font-weight:600;
            ">
              ${escapeHtml(pnr.train_number || "Not available")}
              ${
                pnr.train_name
                  ? ` — ${escapeHtml(pnr.train_name)}`
                  : ""
              }
            </td>
          </tr>

          <tr>
            <td style="
              padding:8px 0;
              color:#777777;
            ">
              Journey Date
            </td>

            <td style="
              padding:8px 0;
              text-align:right;
              font-weight:600;
            ">
              ${journeyDate}
            </td>
          </tr>

          <tr>
            <td style="
              padding:8px 0;
              color:#777777;
            ">
              Checked At
            </td>

            <td style="
              padding:8px 0;
              text-align:right;
              font-weight:600;
            ">
              ${formatCheckedTime()}
            </td>
          </tr>

        </table>

      </div>

      <!-- Monitoring message -->
      <div style="
        margin-top:24px;
        background:#f7f7f7;
        border-radius:10px;
        padding:18px;
        font-size:14px;
        line-height:1.6;
        color:#555555;
      ">
        <strong style="color:#171717;">
          Monitoring continues
        </strong>
        <br>
        Your PNR is still being monitored. You'll receive another email
        whenever the booking status changes.
      </div>

      <!-- Button -->
      ${
        buttonHtml
          ? `
            <div style="
              margin-top:25px;
              text-align:center;
            ">
              ${buttonHtml}
            </div>
          `
          : ""
      }

    </div>

    <!-- Footer -->
    <div style="
      border-top:1px solid #eeeeee;
      padding:20px 30px;
      text-align:center;
      font-size:12px;
      color:#999999;
    ">
      PNR Monitor<br>
      Automatic status notification
    </div>

  </div>

</body>
</html>
`;

  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: [pnr.email],
    subject,
    html,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  console.log(`[NOTIFIER] Email sent to ${pnr.email}`);
}

module.exports = {
  notifyStatusChange,
};