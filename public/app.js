const state = {
  pnrs: [],
  histories: new Map(),
  historyRecords: [],
  lastLoadedAt: null,
  routeHydrationQueued: false,
  routeHydratedIds: new Set()
};

const els = {
  form: document.getElementById("pnrForm"),
  pnrNumber: document.getElementById("pnrNumber"),
  email: document.getElementById("email"),
  addButton: document.getElementById("addButton"),
  message: document.getElementById("message"),
  refreshButton: document.getElementById("refreshButton"),
  navRefreshButton: document.getElementById("navRefreshButton"),
  pnrList: document.getElementById("pnrList"),
  historyList: document.getElementById("historyList"),
  countBadge: document.getElementById("countBadge"),
  healthBadge: document.getElementById("healthBadge"),
  updatedTime: document.getElementById("updatedTime"),
  metricActive: document.getElementById("metricActive"),
  metricWaitlist: document.getElementById("metricWaitlist"),
  metricChanges: document.getElementById("metricChanges"),
  metricChecked: document.getElementById("metricChecked"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  modalBody: document.getElementById("modalBody"),
  modalClose: document.getElementById("modalClose"),
  toastRegion: document.getElementById("toastRegion"),
  mobileMenuButton: document.getElementById("mobileMenuButton"),
  mobileNav: document.getElementById("mobileNav"),
  navLinks: Array.from(document.querySelectorAll(".nav-link[data-nav-target]")),
  mobileNavLinks: Array.from(document.querySelectorAll(".mobile-nav a[data-nav-target]"))
};

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({ success: false, error: "Invalid server response." }));
  if (!response.ok || result.success === false) throw new Error(result.error || "Request failed.");
  return result;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata"
});

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata"
});

const journeyDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata"
});

function fmtDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormatter.format(date);
}

function fmtTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormatter.format(date);
}

function formatJourneyDate(value) {
  if (!value) return "Unknown";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return journeyDateFormatter.format(date);
}

function parseStatus(status) {
  const value = String(status || "").toUpperCase();
  if (value.includes("CNF") || value.includes("CONFIRMED")) return { kind: "cnf", label: "CNF", text: "Confirmed" };
  if (value.includes("RAC")) return { kind: "rac", label: "RAC", text: "RAC" };
  if (value.includes("CANCEL")) return { kind: "cancelled", label: "CANCELLED", text: "Cancelled" };
  if (value.includes("DELAY")) return { kind: "delayed", label: "DELAYED", text: "Delayed" };
  if (value.includes("RESCHED")) return { kind: "rescheduled", label: "RESCHEDULED", text: "Rescheduled" };
  if (value.includes("WL") || value.includes("GNWL") || value.includes("RLWL") || value.includes("PQWL")) return { kind: "wl", label: "WL", text: "Waitlist" };
  return { kind: "neutral", label: "LIVE", text: "Current" };
}

function statusBadge(status) {
  const parsed = parseStatus(status);
  return `<div class="status-badge status-${parsed.kind}"><span class="badge-dot"></span><span>${escapeHtml(parsed.label)}</span></div>`;
}

function getStation(pnr, direction) {
  const nameKey = `${direction}_station_name`;
  const codeKey = `${direction}_station_code`;
  const nestedKey = direction === "from" ? "from" : "to";
  const nested = pnr[nestedKey];
  const fallbackName = direction === "from" ? "Origin" : "Destination";

  return {
    name: pnr[nameKey] || nested?.name || fallbackName,
    code: pnr[codeKey] || nested?.code || "—"
  };
}

function canonicalStatus(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function meaningfulHistoryItems(items, { includeInitial = true } = {}) {
  const source = Array.isArray(items) ? items : [];
  const meaningful = source.filter(item => {
    const oldStatus = canonicalStatus(item.old_status);
    const newStatus = canonicalStatus(item.new_status);
    const isInitial = !oldStatus;
    if (isInitial) return includeInitial && Boolean(newStatus);
    return Boolean(newStatus) && oldStatus !== newStatus;
  });

  // Legacy versions could write duplicate rows. Keep one copy of the same
  // event even when the database contains repeated records.
  const seen = new Set();
  return meaningful.filter(item => {
    const key = [
      item.pnr_id,
      item.checked_at,
      canonicalStatus(item.old_status),
      canonicalStatus(item.new_status)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderRoute(pnr) {
  const from = getStation(pnr, "from");
  const to = getStation(pnr, "to");
  const hasRealRoute = Boolean(
    pnr.from_station_name ||
    pnr.from_station_code ||
    pnr.to_station_name ||
    pnr.to_station_code ||
    pnr.from?.name ||
    pnr.to?.name
  );

  return `
    <div class="route-visual ${hasRealRoute ? "route-real" : "route-placeholder"}" aria-label="Journey route from ${escapeHtml(from.name)} to ${escapeHtml(to.name)}">
      <div class="route-station route-station-from">
        <strong>${escapeHtml(from.name)}</strong>
        <span>${escapeHtml(from.code)}</span>
      </div>
      <div class="route-track">
        <div class="route-rails" aria-hidden="true"><i></i><i></i><b></b></div>
        <span class="route-node route-node-start" aria-hidden="true"></span>
        <span class="route-node route-node-end" aria-hidden="true"></span>
        <span class="route-scan-line" aria-hidden="true"></span>
        <img class="route-train" src="assets/graphics/train-side.webp" alt="Train on route">
        <span class="route-arrow" aria-hidden="true">→</span>
      </div>
      <div class="route-station route-station-to">
        <strong>${escapeHtml(to.name)}</strong>
        <span>${escapeHtml(to.code)}</span>
      </div>
    </div>
  `;
}

function showToast(title, detail, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span>`;
  els.toastRegion.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function setMessage(text = "", type = "") {
  els.message.textContent = text;
  els.message.className = `form-feedback ${type}`.trim();
}

function setRefreshBusy(button, busy) {
  button.disabled = busy;
  const img = button.querySelector("img");
  if (img) img.classList.toggle("spin", busy);
}

function calculateMetrics() {
  const active = state.pnrs.length;
  const waitlisted = state.pnrs.filter(p => parseStatus(p.current_status).kind === "wl").length;
  const changed = state.historyRecords.filter(item => item.old_status).length;
  let latest = null;

  for (const item of state.historyRecords) {
    const t = new Date(item.checked_at).getTime();
    if (!Number.isNaN(t) && (!latest || t > latest)) latest = t;
  }

  for (const pnr of state.pnrs) {
    const t = new Date(pnr.last_checked_at).getTime();
    if (!Number.isNaN(t) && (!latest || t > latest)) latest = t;
  }

  els.metricActive.textContent = `${active} / 10`;
  els.metricWaitlist.textContent = String(waitlisted);
  els.metricChanges.textContent = String(changed);
  els.metricChecked.textContent = latest ? fmtTime(latest) : "—";
  els.countBadge.textContent = `${active} / 10 active`;
  els.updatedTime.textContent = state.lastLoadedAt ? `Last updated ${fmtDateTime(state.lastLoadedAt)}` : "Not updated yet";
}

async function loadPNRs() {
  const result = await api("/api/dashboard");

  state.pnrs = Array.isArray(result.pnrs) ? result.pnrs : [];
  state.historyRecords = meaningfulHistoryItems(
    Array.isArray(result.historyRecords) ? result.historyRecords : [],
    { includeInitial: false }
  );

  const historyMap = new Map();
  for (const pnr of state.pnrs) {
    const items = Array.isArray(result.histories?.[String(pnr.id)])
      ? result.histories[String(pnr.id)]
      : [];
    historyMap.set(String(pnr.id), meaningfulHistoryItems(items, { includeInitial: true }));
  }
  state.histories = historyMap;

  // The dashboard is rendered immediately from Supabase data. Any missing
  // route is fetched in the background so the initial page is not blocked by
  // external API calls.
  els.healthBadge.innerHTML = `
    <span class="status-dot" style="${result.providerEnabled ? "" : "background:#f6bf2f;box-shadow:none"}"></span>
    <span>${result.providerEnabled ? "System online" : "Provider not configured"}</span>
  `;

  renderPNRs();
  renderHistory();

  state.lastLoadedAt = new Date();
  calculateMetrics();
  syncActiveNavigation();

  queueMissingRouteHydration(
    Array.isArray(result.routeMissingIds) ? result.routeMissingIds : []
  );
}

function queueMissingRouteHydration(ids) {
  if (state.routeHydrationQueued || !ids.length) return;

  const pendingIds = ids
    .map(Number)
    .filter(Number.isFinite)
    .filter(id => !state.routeHydratedIds.has(id));

  if (!pendingIds.length) return;

  state.routeHydrationQueued = true;

  const run = () => {
    state.routeHydrationQueued = false;
    hydrateMissingRoutesInBackground(pendingIds).catch(() => {});
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1800 });
  } else {
    window.setTimeout(run, 900);
  }
}

async function hydrateMissingRoutesInBackground(ids) {
  // Keep provider traffic small. Two concurrent route lookups are enough
  // because route hydration is a one-time compatibility operation.
  let cursor = 0;

  let changed = false;

  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      if (state.routeHydratedIds.has(id)) continue;

      state.routeHydratedIds.add(id);

      try {
        const result = await api(`/api/pnrs/${id}/refresh-route`, { method: "POST" });
        const pnr = state.pnrs.find(item => Number(item.id) === id);
        if (!pnr || !result.route) continue;

        pnr.from_station_name = result.route.from_station_name || pnr.from_station_name || null;
        pnr.from_station_code = result.route.from_station_code || pnr.from_station_code || null;
        pnr.to_station_name = result.route.to_station_name || pnr.to_station_name || null;
        pnr.to_station_code = result.route.to_station_code || pnr.to_station_code || null;
        changed = true;
      } catch {
        // Route hydration is intentionally non-blocking. A failed lookup
        // should never make the dashboard wait or appear broken.
      }
    }
  };

  await Promise.all([worker(), worker()]);
  if (changed) renderPNRs();
}

function renderPNRs() {
  if (!state.pnrs.length) {
    els.pnrList.innerHTML = `
      <div class="empty-state">
        <img src="assets/states/empty.svg" alt="">
        <h3>No PNRs being monitored</h3>
        <p>Add your first PNR to start automatic hourly monitoring.</p>
        <a class="primary-button" href="#add-pnr" style="display:inline-flex;text-decoration:none;"><span>+</span> Add your first PNR</a>
      </div>
    `;
    return;
  }

  els.pnrList.innerHTML = state.pnrs.map(createPNRCard).join("");
  attachPNRCardEvents();
}

function createPNRCard(pnr) {
  const history = state.histories.get(String(pnr.id)) || [];
  const lastChecked = pnr.last_checked_at ? fmtDateTime(pnr.last_checked_at) : "Never";
  const trainLabel = `${pnr.train_number || "Unknown"}${pnr.train_name ? ` · ${pnr.train_name}` : ""}`;
  const status = parseStatus(pnr.current_status);

  return `
    <article class="pnr-card status-card-${status.kind}" data-pnr-id="${escapeHtml(pnr.id)}">
      <div class="pnr-ticket">
        <div class="ticket-left">
          <div class="ticket-overline">MONITORED PNR</div>
          <div class="ticket-pnr">${escapeHtml(pnr.pnr_number)}</div>
          <div class="ticket-email">${escapeHtml(pnr.email)}</div>
          <div class="monitoring-label"><i></i> Monitoring active</div>
          <div class="detail-row">
            <div><div class="detail-label">Journey</div><div class="detail-value">${escapeHtml(formatJourneyDate(pnr.journey_date))}</div></div>
            <div><div class="detail-label">Provider</div><div class="detail-value">API Mitra</div></div>
          </div>
          <div class="ticket-code" aria-hidden="true"><span>PNR ${escapeHtml(pnr.pnr_number)}</span><i></i></div>
        </div>

        <div class="ticket-main">
          <div class="current-status-label">CURRENT RESERVATION STATUS</div>
          <div class="status-heading-row">
            <div class="current-status">${escapeHtml(pnr.current_status || "Unknown")}</div>
            ${statusBadge(pnr.current_status)}
          </div>
          <div class="status-support">Live passenger status returned by the PNR provider.</div>

          ${renderRoute(pnr)}

          <div class="main-detail train-detail">
            <small>TRAIN</small>
            <strong>${escapeHtml(trainLabel)}</strong>
          </div>

          <div class="tracking-strip">
            <span><i></i>Hourly monitoring</span>
            <span>Stops automatically at a terminal journey state</span>
          </div>
        </div>

        <div class="ticket-right">
          <div class="ticket-right-top">
            <div class="ticket-visual"><img src="assets/graphics/train-side.webp" alt="Train illustration" loading="lazy" decoding="async"></div>
            <div class="ticket-date"><span>JOURNEY</span><b>${escapeHtml(formatJourneyDate(pnr.journey_date))}</b></div>
          </div>
          <div class="last-check"><b>Last checked</b><br>${escapeHtml(lastChecked)}<br><span>Automatic hourly monitoring</span></div>
          <div class="ticket-actions">
            <button class="card-action history-btn" type="button"><img src="assets/icons/icon-history.svg" alt="">History</button>
            <button class="card-action danger remove-btn" type="button"><img src="assets/icons/icon-delete.svg" alt="">Stop</button>
          </div>
        </div>
      </div>
      <div class="history-inline" id="history-${escapeHtml(pnr.id)}">${renderInlineHistory(history)}</div>
    </article>
  `;
}

function renderInlineHistory(history) {
  if (!history.length) return `<div class="history-note">No recorded history yet.</div>`;
  return history.slice(0, 6).map(item => `
    <div class="history-item">
      <div class="history-time">${escapeHtml(fmtDateTime(item.checked_at))}</div>
      <div class="history-move"><span class="from">${escapeHtml(item.old_status || "Initial")}</span><span class="arrow">→</span><span class="to">${escapeHtml(item.new_status)}</span></div>
      <div class="history-note">Recorded status</div>
    </div>
  `).join("");
}

function attachPNRCardEvents() {
  document.querySelectorAll(".pnr-card").forEach(card => {
    const id = card.dataset.pnrId;
    const pnr = state.pnrs.find(item => String(item.id) === id);
    card.querySelector(".history-btn")?.addEventListener("click", () => {
      const box = document.getElementById(`history-${id}`);
      box?.classList.toggle("open");
    });
    card.querySelector(".remove-btn")?.addEventListener("click", () => openRemoveModal(pnr));
  });
}

function renderHistory() {
  const rows = meaningfulHistoryItems(state.historyRecords, { includeInitial: false })
    .sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at));

  if (!rows.length) {
    els.historyList.innerHTML = `<div class="history-empty">No status changes recorded yet. The initial status is kept inside each PNR card.</div>`;
    return;
  }

  els.historyList.innerHTML = `
    <div class="history-header"><span>TIME (IST)</span><span>PNR</span><span>TRAIN</span><span>STATE</span><span>MOVEMENT</span></div>
    ${rows.slice(0, 12).map(item => {
      const pnr = item.pnr;
      const stateLabel = pnr.active ? "Monitoring" : "Completed";
      return `
        <div class="history-row">
          <span class="time" data-label="Time (IST)">${escapeHtml(fmtDateTime(item.checked_at))}</span>
          <span class="pnr" data-label="PNR">${escapeHtml(pnr.pnr_number)}</span>
          <span class="train" data-label="Train">${escapeHtml(pnr.train_number || "—")} ${escapeHtml(pnr.train_name || "")}</span>
          <span class="history-state ${pnr.active ? "active" : "complete"}" data-label="State">${escapeHtml(stateLabel)}</span>
          <span class="movement" data-label="Movement">${escapeHtml(item.old_status || "Initial")} → ${escapeHtml(item.new_status)}</span>
        </div>
      `;
    }).join("")}
  `;
}

function openRemoveModal(pnr) {
  if (!pnr) return;
  els.modalBody.innerHTML = `
    <div class="modal-kicker">STOP MONITORING</div>
    <h3 id="modalTitle">Stop this PNR?</h3>
    <p class="modal-sub">The PNR will leave the active dashboard. Its saved status history will remain in the database.</p>
    <div class="modal-grid">
      <div class="modal-field"><span>PNR Number</span><b>${escapeHtml(pnr.pnr_number)}</b></div>
      <div class="modal-field"><span>Current Status</span><b>${escapeHtml(pnr.current_status || "Unknown")}</b></div>
      <div class="modal-field"><span>Train</span><b>${escapeHtml(pnr.train_number || "Unknown")} ${escapeHtml(pnr.train_name || "")}</b></div>
      <div class="modal-field"><span>Journey Date</span><b>${escapeHtml(formatJourneyDate(pnr.journey_date))}</b></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px">
      <button class="secondary-button" type="button" id="modalCancel">Cancel</button>
      <button class="card-action danger" type="button" id="modalConfirm" style="flex:0 0 auto;padding:0 18px;min-height:42px">Stop Monitoring</button>
    </div>
  `;

  openModal();
  document.getElementById("modalCancel")?.addEventListener("click", closeModal);
  document.getElementById("modalConfirm")?.addEventListener("click", async () => {
    const button = document.getElementById("modalConfirm");
    button.disabled = true;
    try {
      await api(`/api/pnrs/${pnr.id}`, { method: "DELETE" });
      closeModal();
      showToast("Monitoring stopped", `PNR ${pnr.pnr_number} was removed from active monitoring.`);
      await refreshDashboard();
    } catch (error) {
      button.disabled = false;
      showToast("Could not stop monitoring", error.message, "error");
    }
  });
}

function openHistoryModal() {
  const rows = meaningfulHistoryItems(state.historyRecords, { includeInitial: false })
    .sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at));
  els.modalBody.innerHTML = `
    <div class="modal-kicker">HISTORY</div>
    <h3 id="modalTitle">Status changes</h3>
    <p class="modal-sub">${rows.length} meaningful status movements across monitored and completed PNRs.</p>
    <div class="modal-history">${rows.length ? rows.slice(0, 100).map(item => `
      <div class="modal-history-row"><span><b>${escapeHtml(item.pnr?.pnr_number || "—")}</b> &nbsp; ${escapeHtml(item.old_status || "Initial")} → ${escapeHtml(item.new_status)}</span><span>${escapeHtml(fmtDateTime(item.checked_at))}</span></div>
    `).join("") : `<div class="history-empty">No history recorded yet.</div>`}</div>
  `;
  openModal();
}

function openModal() {
  els.modalBackdrop.hidden = false;
  document.body.classList.add("modal-open");
}

function closeModal() {
  els.modalBackdrop.hidden = true;
  document.body.classList.remove("modal-open");
}

function toggleMobileNav(force) {
  if (!els.mobileNav || !els.mobileMenuButton) return;
  const nextOpen = typeof force === "boolean" ? force : els.mobileNav.hidden;
  els.mobileNav.hidden = !nextOpen;
  els.mobileMenuButton.setAttribute("aria-expanded", String(nextOpen));
  els.mobileMenuButton.setAttribute("aria-label", nextOpen ? "Close navigation" : "Open navigation");
  els.mobileMenuButton.title = nextOpen ? "Close navigation" : "Open navigation";
  els.mobileMenuButton.classList.toggle("open", nextOpen);
}

async function refreshDashboard() {
  setRefreshBusy(els.refreshButton, true);
  setRefreshBusy(els.navRefreshButton, true);
  try {
    await loadPNRs();
  } catch (error) {
    els.pnrList.innerHTML = `<div class="empty-state"><img src="assets/states/error.svg" alt=""><h3>Unable to load PNRs</h3><p>${escapeHtml(error.message)}</p><button class="secondary-button" type="button" id="retryButton"><img src="assets/icons/icon-refresh.svg" alt="">Try again</button></div>`;
    document.getElementById("retryButton")?.addEventListener("click", refreshDashboard);
    showToast("Dashboard refresh failed", error.message, "error");
  } finally {
    setRefreshBusy(els.refreshButton, false);
    setRefreshBusy(els.navRefreshButton, false);
  }
}

els.form?.addEventListener("submit", async event => {
  event.preventDefault();
  const pnrNumber = els.pnrNumber.value.trim();
  const email = els.email.value.trim();

  if (!/^\d{10}$/.test(pnrNumber)) {
    setMessage("Enter exactly 10 digits for the PNR number.", "error");
    els.pnrNumber.focus();
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setMessage("Enter a valid notification email.", "error");
    els.email.focus();
    return;
  }

  els.addButton.disabled = true;
  setMessage("Checking PNR and adding it to monitoring…");

  try {
    await api("/api/pnrs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pnrNumber, email })
    });
    els.form.reset();
    setMessage("PNR added successfully. Hourly monitoring is now active.", "success");
    showToast("PNR added successfully", `Monitoring ${pnrNumber} every hour.`);
    await refreshDashboard();
  } catch (error) {
    setMessage(error.message, "error");
    showToast("Could not add PNR", error.message, "error");
  } finally {
    els.addButton.disabled = false;
  }
});

els.refreshButton?.addEventListener("click", refreshDashboard);
els.navRefreshButton?.addEventListener("click", refreshDashboard);
document.getElementById("viewAllHistoryButton")?.addEventListener("click", openHistoryModal);
els.modalClose?.addEventListener("click", closeModal);
els.modalBackdrop?.addEventListener("click", event => {
  if (event.target === els.modalBackdrop) closeModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !els.modalBackdrop.hidden) closeModal();
  if (event.key === "Escape" && els.mobileNav && !els.mobileNav.hidden) toggleMobileNav(false);
});

function setActiveNavigation(target) {
  const normalized = target || "dashboard";
  [...els.navLinks, ...els.mobileNavLinks].forEach(link => {
    const isActive = link.dataset.navTarget === normalized;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function syncActiveNavigation() {
  const sections = [
    document.getElementById("dashboard"),
    document.getElementById("pnrs"),
    document.getElementById("history"),
    document.getElementById("how-it-works"),
    document.getElementById("help")
  ].filter(Boolean);

  const headerOffset = (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-height"), 10) || 76) + 110;
  let activeId = "dashboard";

  for (const section of sections) {
    if (section.getBoundingClientRect().top <= headerOffset) activeId = section.id;
  }

  setActiveNavigation(activeId);
}

function navigateToHash(hash) {
  const target = String(hash || "#dashboard").replace(/^#/, "") || "dashboard";
  const section = document.getElementById(target);
  if (!section) return;

  setActiveNavigation(target);
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#${target}`);
}

[...els.navLinks, ...els.mobileNavLinks].forEach(link => {
  link.addEventListener("click", event => {
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("#")) return;
    event.preventDefault();
    navigateToHash(href);
    toggleMobileNav(false);
  });
});

els.mobileMenuButton?.addEventListener("click", () => toggleMobileNav());

let navScrollFrame = 0;
window.addEventListener("scroll", () => {
  if (navScrollFrame) return;
  navScrollFrame = requestAnimationFrame(() => {
    navScrollFrame = 0;
    syncActiveNavigation();
  });
}, { passive: true });

window.addEventListener("hashchange", () => {
  const target = window.location.hash.replace(/^#/, "");
  if (target) navigateToHash(`#${target}`);
});

if (window.location.hash) {
  const initialTarget = document.getElementById(window.location.hash.replace(/^#/, ""));
  if (initialTarget) {
    setActiveNavigation(initialTarget.id);
    requestAnimationFrame(() => initialTarget.scrollIntoView({ behavior: "auto", block: "start" }));
  }
} else {
  setActiveNavigation("dashboard");
}

refreshDashboard();
