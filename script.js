const API_BASE_URL = "";
const AUTO_REFRESH_MS = 10000;

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "devops-pulse-demo-v1";

const initialBuilds = [
  { id: "1042", status: "SUCCEEDED", duration: 42, age: 2 },
  { id: "1041", status: "SUCCEEDED", duration: 51, age: 24 },
  { id: "1040", status: "FAILED", duration: 19, age: 65 },
  { id: "1039", status: "SUCCEEDED", duration: 38, age: 140 },
  { id: "1038", status: "SUCCEEDED", duration: 45, age: 230 },
  { id: "1037", status: "FAILED", duration: 27, age: 360 },
  { id: "1036", status: "SUCCEEDED", duration: 33, age: 500 },
  { id: "1035", status: "SUCCEEDED", duration: 41, age: 650 },
  { id: "1034", status: "SUCCEEDED", duration: 36, age: 900 },
  { id: "1033", status: "SUCCEEDED", duration: 48, age: 1200 },
  { id: "1032", status: "FAILED", duration: 22, age: 1500 },
  { id: "1031", status: "SUCCEEDED", duration: 31, age: 1800 },
  { id: "1030", status: "SUCCEEDED", duration: 39, age: 2200 },
  { id: "1029", status: "SUCCEEDED", duration: 44, age: 2600 }
];

let builds = [];
let currentStatus = "SUCCEEDED";
let currentLed = "GREEN";
let isLive = false;
let lastUpdated = null;
let toastTimer;
let lastApiError = "";

function timeAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function makeInitialData() {
  return initialBuilds.map((item) => ({
    id: item.id,
    pipeline: "DevOpsPipeline",
    status: item.status,
    duration: item.duration,
    led: item.status === "FAILED" ? "RED" : "GREEN",
    timestamp: timeAgo(item.age),
    executionId: `demo-${item.id}`
  }));
}

function loadDemoData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (error) {
    console.warn("Could not load saved demo history.", error);
  }
  return makeInitialData();
}

function saveDemoData() {
  if (!isLive) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(builds.slice(0, 100)));
    } catch (error) {
      console.warn("Demo history could not be saved.", error);
    }
  }
}

function normalizeStatus(status) {
  const value = String(status || "").toUpperCase();

  if (["SUCCEEDED", "SUCCESS", "PASSED", "PASS"].includes(value)) {
    return "SUCCEEDED";
  }

  if (["FAILED", "FAILURE", "FAIL", "ERROR"].includes(value)) {
    return "FAILED";
  }

  if ([
    "IN_PROGRESS", "RUNNING", "STARTED", "STOPPING",
    "STOPPED", "CANCELED", "CANCELLED", "UNKNOWN"
  ].includes(value)) {
    return value === "RUNNING" || value === "STARTED"
      ? "IN_PROGRESS"
      : value;
  }

  return "UNKNOWN";
}

function ledFor(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "SUCCEEDED") return "GREEN";
  if (normalized === "FAILED") return "RED";
  return "BLUE";
}

function statusLabel(status) {
  const labels = {
    SUCCEEDED: "PASSED",
    FAILED: "FAILED",
    IN_PROGRESS: "RUNNING",
    STOPPED: "STOPPED",
    STOPPING: "STOPPING",
    CANCELED: "CANCELED",
    UNKNOWN: "UNKNOWN"
  };
  return labels[normalizeStatus(status)] || "UNKNOWN";
}

function durationLabel(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) {
    return "—";
  }

  const n = Math.max(0, Number(seconds));
  if (n < 60) return `${Math.round(n)} sec`;

  const minutes = Math.floor(n / 60);
  const remainder = Math.round(n % 60);
  return `${minutes}m ${remainder}s`;
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelative(value) {
  if (!value) return "Waiting for update";

  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  return `${Math.floor(hours / 24)} day(s) ago`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setNotice(message) {
  $("actionMessage").textContent = message;
}

function latestBuild() {
  return builds[0] || null;
}

function updateConnectionUI(connected, message) {
  $("modePill").textContent = isLive ? "● AWS API MODE" : "● DEMO MODE";
  $("modePill").style.color = isLive ? "#57d5f6" : "#f6c768";
  $("modePill").style.background = isLive ? "#18364a" : "#332c20";

  $("cloudLabel").textContent = isLive ? "AWS API configured" : "Demo environment";
  $("connectionText").textContent = message;
  $("connectionText").style.color = connected ? "#35d995" : "#ff687a";

  $("deviceStatus").textContent = isLive
    ? (connected ? "API OK" : "OFFLINE")
    : "DEMO";

  $("deviceDescription").textContent = isLive
    ? (connected ? "API reachable; device telemetry not verified" : "API connection failed")
    : "ESP32 connection not verified";

  $("deviceBadge").textContent = isLive
    ? (connected ? "API REACHABLE" : "API ERROR")
    : "DEMO";

  $("deviceConnection").textContent = isLive
    ? (connected ? "API reachable" : "API unavailable")
    : "Simulation only";
}

function renderDashboard() {
  const latest = latestBuild();

  if (!latest) {
    $("historyBody").innerHTML =
      '<tr><td colspan="6">No build records available.</td></tr>';
    return;
  }

  currentStatus = normalizeStatus(latest.status);
  currentLed = ledFor(currentStatus);
  lastUpdated = latest.timestamp || new Date().toISOString();

  const successCount = builds.filter(
    (b) => normalizeStatus(b.status) === "SUCCEEDED"
  ).length;

  const completed = builds.filter((b) =>
    ["SUCCEEDED", "FAILED"].includes(normalizeStatus(b.status))
  );

  const failedCount = builds.filter(
    (b) => normalizeStatus(b.status) === "FAILED"
  ).length;

  const rate = completed.length
    ? Math.round((successCount / completed.length) * 1000) / 10
    : 0;

  $("pipelineNameHero").textContent = latest.pipeline || "DevOpsPipeline";
  $("lastUpdatedHero").textContent = formatRelative(lastUpdated);

  $("latestStatus").textContent = statusLabel(currentStatus);
  $("latestStatus").style.color =
    currentStatus === "SUCCEEDED" ? "var(--green)" :
    currentStatus === "FAILED" ? "var(--red)" : "var(--yellow)";

  $("latestExecution").textContent =
    `Build #${latest.id || latest.executionId || "—"}`;

  $("latestNote").textContent = formatTime(lastUpdated);
  $("successRate").textContent = `${rate.toFixed(1)}%`;
  $("failedCount").textContent = String(failedCount);

  const heroLight = $("heroLight");
  heroLight.className = "signal-light";
  if (currentLed === "RED") heroLight.classList.add("failed");
  if (currentLed === "BLUE") heroLight.classList.add("running");

  $("heroStatus").textContent =
    currentStatus === "SUCCEEDED" ? "BUILD PASSED" :
    currentStatus === "FAILED" ? "BUILD FAILED" :
    statusLabel(currentStatus);

  const deviceLed = $("deviceLed");
  deviceLed.className = "device-led";
  if (currentLed === "RED") deviceLed.classList.add("failed");
  if (currentLed === "BLUE") deviceLed.classList.add("running");

  $("ledColorText").textContent = currentLed;
  $("ledColorText").className =
    currentLed === "RED" ? "failed" :
    currentLed === "BLUE" ? "running" : "";

  $("ledLabel").textContent = `Expected LED: ${currentLed}`;
  $("deviceMessage").textContent = isLive
    ? "Signal derived from API pipeline status"
    : "Preview signal — hardware not verified";

  $("deviceLastSeen").textContent = formatTime(lastUpdated);

  renderHistory();
  drawChart();
}

function renderHistory() {
  const query = $("searchInput").value.trim().toLowerCase();
  const filter = $("statusFilter").value;

  const filtered = builds.filter((build) => {
    const status = normalizeStatus(build.status);
    const matchesFilter = filter === "ALL" || status === filter;
    const searchable = [
      build.id, build.executionId, build.pipeline, status, build.led
    ].join(" ").toLowerCase();

    return matchesFilter && searchable.includes(query);
  });

  if (!filtered.length) {
    $("historyBody").innerHTML =
      '<tr><td colspan="6">No executions match your search.</td></tr>';
  } else {
    $("historyBody").innerHTML = filtered.map((build) => {
      const status = normalizeStatus(build.status);
      const led = ledFor(status);

      const cssStatus =
        status === "SUCCEEDED" ? "succeeded" :
        status === "FAILED" ? "failed" : "in_progress";

      const ledCss =
        led === "RED" ? "failed" :
        led === "BLUE" ? "running" : "";

      return `
        <tr>
          <td class="execution-id">#${escapeHtml(build.id || "—")}</td>
          <td>${escapeHtml(build.pipeline || "DevOpsPipeline")}</td>
          <td><span class="table-status ${cssStatus}">${escapeHtml(statusLabel(status))}</span></td>
          <td>${escapeHtml(durationLabel(build.duration))}</td>
          <td><span class="led-cell"><i class="led-mini ${ledCss}"></i>${escapeHtml(led)}</span></td>
          <td>${escapeHtml(formatTime(build.timestamp))}</td>
        </tr>`;
    }).join("");
  }

  $("tableCount").textContent =
    `${filtered.length} execution${filtered.length === 1 ? "" : "s"}`;
}

function drawChart() {
  const canvas = $("activityChart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();

  if (!rect.width || !rect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const count = Number($("chartRange").value) || 7;
  const data = builds.slice(0, count).reverse();
  const pad = { left: 35, right: 12, top: 15, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (!data.length || plotW <= 0 || plotH <= 0) return;

  const maxValue = Math.max(
    60,
    ...data.map((b) => Number(b.duration) || 0)
  );

  ctx.font = "10px system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH * i / 4;
    const value = Math.round(maxValue * (1 - i / 4));

    ctx.strokeStyle = "#26364c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = "#8194ad";
    ctx.fillText(String(value), pad.left - 8, y);
  }

  const slot = plotW / data.length;
  const barWidth = Math.min(25, slot * 0.54);

  data.forEach((build, index) => {
    const duration = Math.max(0, Number(build.duration) || 0);
    const barH = Math.max(3, duration / maxValue * plotH);
    const x = pad.left + index * slot + (slot - barWidth) / 2;
    const y = pad.top + plotH - barH;
    const status = normalizeStatus(build.status);

    ctx.fillStyle = status === "FAILED" ? "#ff687a" :
      status === "SUCCEEDED" ? "#35d995" : "#f6c768";

    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barH, [4, 4, 1, 1]);
    ctx.fill();

    ctx.fillStyle = "#8194ad";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const label = String(build.id || "").slice(-4);
    ctx.fillText(label, x + barWidth / 2, height - pad.bottom + 10);
  });

  const successes = data.filter(
    (b) => normalizeStatus(b.status) === "SUCCEEDED"
  ).length;

  $("chartSummary").textContent =
    `${data.length} builds · ${successes} successful in this view`;
}

function simulateBuild(status) {
  if (isLive) {
    showToast("Demo simulation is disabled in AWS API mode.");
    return;
  }

  const nextId = String(
    Math.max(...builds.map((b) => Number(b.id) || 0), 1000) + 1
  );

  const normalized = normalizeStatus(status);
  const duration = normalized === "FAILED"
    ? 12 + Math.floor(Math.random() * 35)
    : normalized === "IN_PROGRESS"
      ? 8 + Math.floor(Math.random() * 20)
      : 25 + Math.floor(Math.random() * 45);

  const record = {
    id: nextId,
    pipeline: "DevOpsPipeline",
    status: normalized,
    duration,
    led: ledFor(normalized),
    timestamp: new Date().toISOString(),
    executionId: `demo-${nextId}`
  };

  builds.unshift(record);
  builds = builds.slice(0, 100);

  saveDemoData();
  renderDashboard();

  const message =
    normalized === "SUCCEEDED" ? `Build #${nextId} passed. LED preview: GREEN.` :
    normalized === "FAILED" ? `Build #${nextId} failed. LED preview: RED.` :
    `Build #${nextId} is running. LED preview: BLUE.`;

  setNotice(message);
  showToast(message);
}

async function requestJson(path) {
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}${path}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API request failed: HTTP ${response.status}`);
  }

  return response.json();
}

function parseResponseBody(result) {
  // API Gateway Lambda proxy responses may contain a JSON string in body.
  if (result && typeof result.body === "string") {
    try {
      return JSON.parse(result.body);
    } catch {
      throw new Error("API returned an invalid JSON body.");
    }
  }

  return result?.body && typeof result.body === "object"
    ? result.body
    : result;
}

function normalizeApiBuild(item, index = 0) {
  const status = normalizeStatus(item.status || item.state);
  const timestamp = item.timestamp || item.lastUpdated || new Date().toISOString();

  return {
    id: String(
      item.id || item.executionId || item["execution-id"] || `AWS-${index + 1}`
    ).slice(0, 80),
    executionId: String(
      item.executionId || item["execution-id"] || item.id || "—"
    ),
    pipeline: String(item.pipeline || "DevOpsPipeline"),
    status,
    led: ledFor(status),
    duration: Number.isFinite(Number(item.duration))
      ? Number(item.duration)
      : null,
    timestamp
  };
}

async function refreshFromAws() {
  const rawStatus = await requestJson("/status");
  const status = parseResponseBody(rawStatus);

  if (status.error) throw new Error(status.error);

  const latest = normalizeApiBuild(status);

  // The status endpoint is authoritative for the current latest state.
  const history = [{
    ...latest,
    id: String(
      status.executionId || status["execution-id"] || status.id || "LATEST"
    )
  }];

  // History is optional. If the endpoint does not exist, keep the latest
  // record rather than treating a missing history endpoint as total failure.
  try {
    const rawHistory = await requestJson("/history");
    const result = parseResponseBody(rawHistory);
    const items = Array.isArray(result)
      ? result
      : Array.isArray(result.history)
        ? result.history
        : [];

    if (items.length) {
      history.splice(0, history.length,
        ...items.slice(0, 100).map(normalizeApiBuild)
      );
    }
  } catch (error) {
    console.info("Optional /history endpoint unavailable; showing latest status only.");
  }

  builds = history;
  renderDashboard();
  updateConnectionUI(true, "API reachable");
  $("cloudStatus");
  setNotice("AWS status refreshed successfully.");
  lastApiError = "";
}

async function refreshDashboard() {
  if (!API_BASE_URL.trim()) {
    isLive = false;
    renderDashboard();
    updateConnectionUI(true, "Local simulation active");
    return;
  }

  isLive = true;
  updateConnectionUI(false, "Checking AWS API…");

  try {
    await refreshFromAws();
  } catch (error) {
    console.error(error);
    lastApiError = error.message;
    updateConnectionUI(false, "AWS API request failed");
    setNotice(`Could not retrieve AWS status: ${error.message}`);
    showToast("AWS API unavailable. Check the API URL, CORS and Lambda logs.");
  }
}

function exportCsv() {
  const query = $("searchInput").value.trim().toLowerCase();
  const filter = $("statusFilter").value;

  const rows = builds.filter((build) => {
    const status = normalizeStatus(build.status);
    const searchable = [
      build.id, build.executionId, build.pipeline, status, build.led
    ].join(" ").toLowerCase();

    return (filter === "ALL" || status === filter) &&
      searchable.includes(query);
  });

  const columns = [
    "Execution ID", "Pipeline", "Status", "Duration Seconds", "LED", "Timestamp"
  ];

  const csvEscape = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((b) => [
      b.executionId || b.id,
      b.pipeline,
      normalizeStatus(b.status),
      b.duration ?? "",
      ledFor(b.status),
      b.timestamp
    ].map(csvEscape).join(","))
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "devops-pipeline-history.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  showToast(`Exported ${rows.length} build records.`);
}

function resetDemo() {
  if (isLive) {
    showToast("Reset is available only in demo mode.");
    return;
  }

  builds = makeInitialData();
  saveDemoData();
  renderDashboard();
  setNotice("Demo history has been reset.");
  showToast("Demo data reset.");
}

function init() {
  isLive = Boolean(API_BASE_URL.trim());

  if (!isLive) {
    builds = loadDemoData();
    renderDashboard();
    updateConnectionUI(true, "Local simulation active");
  }

  $("refreshBtn").addEventListener("click", refreshDashboard);
  $("successBtn").addEventListener("click", () => simulateBuild("SUCCEEDED"));
  $("failureBtn").addEventListener("click", () => simulateBuild("FAILED"));
  $("runningBtn").addEventListener("click", () => simulateBuild("IN_PROGRESS"));
  $("resetBtn").addEventListener("click", resetDemo);
  $("exportBtn").addEventListener("click", exportCsv);

  $("searchInput").addEventListener("input", renderHistory);
  $("statusFilter").addEventListener("change", renderHistory);
  $("chartRange").addEventListener("change", drawChart);

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((nav) =>
        nav.classList.remove("active")
      );
      item.classList.add("active");
    });
  });

  window.addEventListener("resize", drawChart);

  refreshDashboard();

  if (API_BASE_URL.trim()) {
    window.setInterval(refreshDashboard, AUTO_REFRESH_MS);
  } else {
    window.setInterval(() => {
      $("lastUpdatedHero").textContent = formatRelative(lastUpdated);
    }, 30000);
  }
}
