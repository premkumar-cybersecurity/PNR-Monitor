const form = document.getElementById("pnrForm");
const pnrList = document.getElementById("pnrList");
const message = document.getElementById("message");
const refreshButton = document.getElementById("refreshButton");
const countBadge = document.getElementById("countBadge");
const healthBadge = document.getElementById("healthBadge");
const addButton = document.getElementById("addButton");

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({
    success: false,
    error: "Invalid server response."
  }));

  if (!response.ok || result.success === false) {
    throw new Error(result.error || "Request failed.");
  }

  return result;
}

async function loadHealth() {
  try {
    const result = await api("/api/health");
    healthBadge.textContent = result.providerEnabled
      ? "Server online · Provider enabled"
      : "Server online · Provider not configured";
  } catch {
    healthBadge.textContent = "Server unavailable";
  }
}

async function loadPNRs() {
  try {
    const result = await api("/api/pnrs");

    countBadge.textContent = `${result.pnrs.length} / 10`;

    if (!result.pnrs.length) {
      pnrList.innerHTML = `
        <div class="empty">
          No PNRs are being monitored yet.
        </div>
      `;
      return;
    }

    pnrList.innerHTML = "";

    for (const pnr of result.pnrs) {
      const card = document.createElement("article");
      card.className = "pnr-card";

      const lastChecked = pnr.last_checked_at
        ? new Date(pnr.last_checked_at).toLocaleString()
        : "Never";

      card.innerHTML = `
        <div class="pnr-top">
          <div class="pnr-number">PNR ${escapeHtml(pnr.pnr_number)}</div>
          <span class="count">Monitoring</span>
        </div>

        <div class="status">${escapeHtml(pnr.current_status || "Unknown")}</div>

        <div class="meta">
          Train: ${escapeHtml(pnr.train_number || "Unknown")}
          ${escapeHtml(pnr.train_name || "")}
        </div>

        <div class="meta">
          Journey: ${escapeHtml(pnr.journey_date || "Unknown")}
        </div>

        <div class="meta">
          Last checked: ${escapeHtml(lastChecked)}
        </div>

        <div class="actions">
          <button class="secondary history-btn">History</button>
          <button class="danger remove-btn">Stop monitoring</button>
        </div>

        <div class="history"></div>
      `;

      card.querySelector(".history-btn").addEventListener("click", async () => {
        const historyBox = card.querySelector(".history");

        if (historyBox.classList.contains("open")) {
          historyBox.classList.remove("open");
          return;
        }

        historyBox.innerHTML = "Loading history...";
        historyBox.classList.add("open");

        try {
          const result = await api(`/api/pnrs/${pnr.id}/history`);

          if (!result.history.length) {
            historyBox.innerHTML = "<p class='meta'>No history yet.</p>";
            return;
          }

          historyBox.innerHTML = result.history.map(item => `
            <div class="history-row">
              <span>
                ${escapeHtml(item.old_status || "Initial")}
                →
                ${escapeHtml(item.new_status)}
              </span>
              <span class="meta">
                ${escapeHtml(new Date(item.checked_at).toLocaleString())}
              </span>
            </div>
          `).join("");
        } catch (error) {
          historyBox.innerHTML =
            `<p class="meta">${escapeHtml(error.message)}</p>`;
        }
      });

      card.querySelector(".remove-btn").addEventListener("click", async () => {
        if (!confirm("Stop monitoring this PNR?")) return;

        try {
          await api(`/api/pnrs/${pnr.id}`, { method: "DELETE" });
          await loadPNRs();
        } catch (error) {
          alert(error.message);
        }
      });

      pnrList.appendChild(card);
    }
  } catch (error) {
    pnrList.innerHTML = `
      <div class="empty">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const pnrNumber = document.getElementById("pnrNumber").value.trim();
  const email = document.getElementById("email").value.trim();

  message.textContent = "Checking PNR...";
  addButton.disabled = true;

  try {
    await api("/api/pnrs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ pnrNumber, email })
    });

    message.textContent =
      "PNR added. Hourly monitoring is now active.";

    form.reset();
    await loadPNRs();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    addButton.disabled = false;
  }
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  await Promise.all([loadHealth(), loadPNRs()]);
  refreshButton.disabled = false;
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadHealth();
loadPNRs();
