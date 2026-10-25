import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cloud,
  Gauge,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Users,
  X,
  Zap,
} from "lucide-react";

type Policy = "NORMAL" | "WATCH" | "THROTTLED" | "BLOCKED";
type Outcome = "success" | "failure" | "limited" | "pending";

interface Metrics {
  ewma_requests_per_second: number;
  rate_deviation: number;
  burst_intensity: number;
  failure_rate: number;
  endpoint_concentration: number;
  requests_in_window: number;
}

interface Client {
  client_id: string;
  policy: Policy;
  risk_score: number;
  tokens_remaining: number;
  metrics: Metrics;
}

interface EventRecord {
  client_id: string;
  timestamp: number;
  endpoint: string;
  outcome: Outcome;
  risk_score?: number;
  policy?: Policy;
}

interface DashboardStatus {
  tracked_clients: number;
  clients: Client[];
}

interface TrafficBucket {
  label: string;
  success: number;
  failure: number;
  limited: number;
}

const EMPTY_STATUS: DashboardStatus = { tracked_clients: 0, clients: [] };
const POLICY_ORDER: Policy[] = ["NORMAL", "WATCH", "THROTTLED", "BLOCKED"];

function policyLabel(policy: Policy) {
  return policy.charAt(0) + policy.slice(1).toLowerCase();
}

function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp * 1000) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${Math.floor(seconds)} sec ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

function makeTimeline(events: EventRecord[]): TrafficBucket[] {
  const now = Date.now() / 1000;
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const start = now - (11 - index) * 5;
    return {
      label: `${Math.max(0, Math.floor(now - start))}s`,
      success: 0,
      failure: 0,
      limited: 0,
    };
  });

  for (const event of events) {
    const age = now - event.timestamp;
    const index = 11 - Math.floor(age / 5);
    if (index < 0 || index > 11) continue;
    if (event.outcome === "success") buckets[index].success += 1;
    if (event.outcome === "failure") buckets[index].failure += 1;
    if (event.outcome === "limited") buckets[index].limited += 1;
  }
  return buckets;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function StatusPill({ policy }: { policy: Policy }) {
  const Icon =
    policy === "NORMAL"
      ? ShieldCheck
      : policy === "WATCH"
        ? CircleHelp
        : policy === "THROTTLED"
          ? ShieldAlert
          : Ban;
  return (
    <span className={`status-pill status-${policy.toLowerCase()}`}>
      <Icon size={13} strokeWidth={2.4} />
      {policyLabel(policy)}
    </span>
  );
}

function TrafficChart({ events }: { events: EventRecord[] }) {
  const buckets = useMemo(() => makeTimeline(events), [events]);
  const max = Math.max(
    5,
    ...buckets.map((bucket) => bucket.success + bucket.failure + bucket.limited),
  );
  const width = 660;
  const height = 190;
  const left = 25;
  const right = 12;
  const top = 12;
  const bottom = 23;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const barWidth = 25;
  const gap = (chartWidth - barWidth * buckets.length) / (buckets.length - 1);
  const y = (value: number) => top + chartHeight - (value / max) * chartHeight;
  const gridValues = [0, Math.ceil(max / 2), max];

  return (
    <div className="chart-wrap">
      <svg
        className="traffic-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Requests per five-second interval during the last minute"
      >
        {gridValues.map((value, index) => (
          <g key={value}>
            <line
              x1={left}
              x2={width - right}
              y1={y(value)}
              y2={y(value)}
              className="chart-grid"
            />
            <text x="0" y={y(value) + 4} className="chart-axis">
              {index === 0 ? "0" : value}
            </text>
          </g>
        ))}
        {buckets.map((bucket, index) => {
          const x = left + index * (barWidth + gap);
          const baseY = y(0);
          const successHeight = (bucket.success / max) * chartHeight;
          const failureHeight = (bucket.failure / max) * chartHeight;
          const limitedHeight = (bucket.limited / max) * chartHeight;
          return (
            <g key={`${bucket.label}-${index}`}>
              <rect
                x={x}
                y={baseY - successHeight}
                width={barWidth}
                height={successHeight}
                rx="3"
                className="chart-success"
              />
              <rect
                x={x}
                y={baseY - successHeight - failureHeight}
                width={barWidth}
                height={failureHeight}
                className="chart-failure"
              />
              <rect
                x={x}
                y={baseY - successHeight - failureHeight - limitedHeight}
                width={barWidth}
                height={limitedHeight}
                rx="3"
                className="chart-limited"
              />
              {index % 2 === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height - 3}
                  textAnchor="middle"
                  className="chart-axis"
                >
                  {60 - index * 5}s
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RiskGauge({ value }: { value: number }) {
  return (
    <div
      className={`risk-gauge ${value >= 70 ? "gauge-danger" : value >= 40 ? "gauge-warn" : ""}`}
      style={{ "--risk": `${Math.min(Math.max(value, 0), 100) * 2.7}deg` } as CSSProperties}
      aria-label={`Risk score ${value} out of 100`}
    >
      <div className="gauge-center">
        <strong>{value}</strong>
        <span>of 100</span>
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<DashboardStatus>(EMPTY_STATUS);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedClient, setSelectedClient] = useState("demo-client");
  const [activeView, setActiveView] = useState("Overview");
  const [searchText, setSearchText] = useState("");
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">(
    "connecting",
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, eventResponse] = await Promise.all([
        fetch("/admin/status"),
        fetch("/admin/events?limit=150"),
      ]);
      if (!statusResponse.ok || !eventResponse.ok) {
        throw new Error("Dashboard API returned an error");
      }
      const nextStatus = (await statusResponse.json()) as DashboardStatus;
      const nextEvents = (await eventResponse.json()) as { events: EventRecord[] };
      setStatus(nextStatus);
      setEvents(nextEvents.events);
      setConnection("online");
      setLastUpdated(new Date());
    } catch {
      setConnection("offline");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const metrics = useMemo(() => {
    const totalRequests = status.clients.reduce(
      (total, client) => total + client.metrics.requests_in_window,
      0,
    );
    const limitedCount = events.filter((event) => event.outcome === "limited").length;
    const failureCount = events.filter((event) => event.outcome === "failure").length;
    const averageRisk = status.clients.length
      ? Math.round(
          status.clients.reduce((total, client) => total + client.risk_score, 0) /
            status.clients.length,
        )
      : 0;
    const atRiskCount = status.clients.filter(
      (client) => client.policy === "THROTTLED" || client.policy === "BLOCKED",
    ).length;
    return {
      totalRequests,
      limitedCount,
      failureCount,
      averageRisk,
      atRiskCount,
    };
  }, [events, status.clients]);

  const filteredClients = useMemo(
    () =>
      status.clients.filter((client) =>
        client.client_id.toLowerCase().includes(searchText.toLowerCase()),
      ),
    [searchText, status.clients],
  );
  const highestRisk = useMemo(
    () =>
      status.clients.reduce<Client | null>(
        (highest, client) => (!highest || client.risk_score > highest.risk_score ? client : highest),
        null,
      ),
    [status.clients],
  );

  async function callEndpoint(path: string, clientId = selectedClient) {
    return fetch(path, {
      headers: { "X-Client-ID": clientId },
    });
  }

  async function runAction(action: "normal" | "failure" | "burst" | "reset") {
    setBusy(true);
    setNotice("");
    try {
      if (action === "reset") {
        const response = await fetch("/admin/reset", { method: "POST" });
        if (!response.ok) throw new Error("Could not reset dashboard state");
        setNotice("Traffic state cleared");
      } else if (action === "normal") {
        const response = await callEndpoint("/api/data");
        if (!response.ok) throw new Error(`Request returned HTTP ${response.status}`);
        setNotice(`Request sent for ${selectedClient}`);
      } else if (action === "failure") {
        const response = await callEndpoint("/api/fail");
        if (response.status !== 500 && response.status !== 429) {
          throw new Error(`Unexpected response: HTTP ${response.status}`);
        }
        setNotice(response.status === 500 ? "Test failure recorded" : "Client was rate-limited");
      } else {
        const responses = await Promise.all(
          Array.from({ length: 20 }, () => callEndpoint("/api/data")),
        );
        const allowed = responses.filter((response) => response.status === 200).length;
        const rejected = responses.length - allowed;
        setNotice(`Burst complete · ${allowed} allowed · ${rejected} limited`);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const requestCount = Math.round(metrics.totalRequests);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Shield size={20} fill="currentColor" /></div>
          <div className="brand-copy">
            <strong>sentinel<span>.</span></strong>
            <small>API SHIELD</small>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switch">
          <span className="workspace-icon"><Cloud size={15} /></span>
          <span className="workspace-copy"><strong>Local environment</strong><small>Development</small></span>
          <ChevronDown size={15} />
        </button>

        <div className="nav-section-label">MONITOR</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button
            className={`nav-item ${activeView === "Overview" ? "active" : ""}`}
            onClick={() => setActiveView("Overview")}
          >
            <LayoutDashboard size={17} /> Overview
            <span className="nav-active-dot" />
          </button>
          <button
            className={`nav-item ${activeView === "Clients" ? "active" : ""}`}
            onClick={() => setActiveView("Clients")}
          >
            <Users size={17} /> API clients
            <span className="nav-count">{status.tracked_clients}</span>
          </button>
          <button
            className={`nav-item ${activeView === "Events" ? "active" : ""}`}
            onClick={() => setActiveView("Events")}
          >
            <ListFilter size={17} /> Event stream
            <span className="live-dot" />
          </button>
        </nav>

        <div className="nav-section-label">SYSTEM</div>
        <div className="system-health">
          <div className="system-health-icon"><Activity size={16} /></div>
          <div className="health-copy"><strong>Protection active</strong><span>Adaptive engine online</span></div>
          <span className="health-pulse" />
        </div>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><CircleHelp size={17} /></div>
            <strong>Need a hand?</strong>
            <p>Explore your API shield and learn how adaptive protection works.</p>
            <a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">View API docs <ArrowUpRight size={13} /></a>
          </div>
          <div className="profile-row">
            <div className="avatar">AD</div>
            <div className="profile-copy"><strong>Administrator</strong><span>Local account</span></div>
            <span className="profile-menu">•••</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeView}</strong></div>
          <div className="topbar-actions">
            <div className={`connection ${connection}`}>
              <span className="connection-dot" />
              {connection === "online" ? "API connected" : connection === "offline" ? "API disconnected" : "Connecting"}
            </div>
            <span className="topbar-divider" />
            <button className="icon-button" aria-label="Refresh dashboard" onClick={() => void refresh()}><RefreshCw size={16} /></button>
            <div className="topbar-avatar">AD</div>
          </div>
        </header>

        {connection === "offline" && (
          <div className="connection-banner"><AlertTriangle size={17} /><span>Can’t reach the API. Start FastAPI on port 8000; the dashboard will reconnect automatically.</span><button onClick={() => void refresh()}>Retry</button></div>
        )}

        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> REAL-TIME SECURITY</div>
              <h1>{activeView === "Overview" ? "Security overview" : activeView}</h1>
              <p className="page-subtitle">Monitor traffic, understand risk, and respond to threats as they happen.</p>
            </div>
            <div className="heading-right">
              <div className="last-updated"><Clock3 size={14} /> Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}</div>
              <button className="button button-primary" onClick={() => void runAction("normal")} disabled={busy || connection !== "online"}><Play size={15} fill="currentColor" /> Send test request</button>
            </div>
          </section>

          <section className="metrics-grid" aria-label="Key performance indicators">
            <article className="metric-card">
              <div className="metric-top"><span>Total requests <CircleHelp size={13} /></span><div className="metric-icon indigo"><Activity size={17} /></div></div>
              <div className="metric-value">{formatCount(requestCount)}<span className="metric-unit">req</span></div>
              <div className="metric-foot"><span className="metric-trend neutral"><Radio size={13} /> Last 60 seconds</span><span className="sparkline spark-indigo">▂▃▂▅▄▆▅█</span></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Protected clients <CircleHelp size={13} /></span><div className="metric-icon blue"><Users size={17} /></div></div>
              <div className="metric-value">{status.tracked_clients}<span className="metric-unit">clients</span></div>
              <div className="metric-foot"><span className="metric-trend good"><ShieldCheck size={13} /> {metrics.atRiskCount} need attention</span><span className="sparkline spark-blue">▂▂▃▃▅▄▆█</span></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Requests limited <CircleHelp size={13} /></span><div className="metric-icon amber"><Ban size={17} /></div></div>
              <div className="metric-value">{formatCount(metrics.limitedCount)}<span className="metric-unit">blocked</span></div>
              <div className="metric-foot"><span className="metric-trend warn"><ArrowDownRight size={13} /> Token bucket enforcement</span><span className="sparkline spark-amber">▂▁▃▂▅▃▇█</span></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Average risk score <CircleHelp size={13} /></span><div className="metric-icon green"><Gauge size={17} /></div></div>
              <div className="metric-value">{metrics.averageRisk}<span className="metric-unit">/ 100</span></div>
              <div className="metric-foot"><span className={`metric-trend ${metrics.averageRisk >= 45 ? "warn" : "good"}`}><ArrowUpRight size={13} /> {metrics.failureCount} failures observed</span><span className="sparkline spark-green">▁▂▂▃▂▅▄▅</span></div>
            </article>
          </section>

          <section className="dashboard-grid">
            <article className="panel traffic-panel">
              <div className="panel-header">
                <div><h2>Traffic overview</h2><p>Live request volume across all monitored clients</p></div>
                <div className="panel-controls"><span className="range-select">Last 60 sec <ChevronDown size={13} /></span><span className="live-label"><span className="live-dot" /> LIVE</span></div>
              </div>
              <div className="chart-legend"><span><i className="legend-dot success-dot" /> Successful</span><span><i className="legend-dot failure-dot" /> Failed</span><span><i className="legend-dot limited-dot" /> Rate limited</span></div>
              <TrafficChart events={events} />
              <div className="chart-footer"><span>60 seconds ago</span><span>Request volume · 5-second intervals</span><span>Now</span></div>
            </article>

            <article className="panel risk-panel">
              <div className="panel-header"><div><h2>Threat posture</h2><p>Adaptive risk assessment</p></div><button className="more-button" aria-label="Risk details">•••</button></div>
              {highestRisk ? (
                <>
                  <div className="risk-focus">
                    <RiskGauge value={highestRisk.risk_score} />
                    <div className="risk-summary"><StatusPill policy={highestRisk.policy} /><strong>{highestRisk.risk_score < 25 ? "All systems nominal" : highestRisk.risk_score < 45 ? "Elevated activity" : "Attention required"}</strong><span>Highest client risk · {highestRisk.client_id}</span></div>
                  </div>
                  <div className="risk-breakdown">
                    <div><span>Rate deviation</span><strong>{Math.round(highestRisk.metrics.rate_deviation * 100)}%</strong><div className="mini-track"><i style={{ width: `${highestRisk.metrics.rate_deviation * 100}%` }} /></div></div>
                    <div><span>Burst intensity</span><strong>{Math.round(highestRisk.metrics.burst_intensity * 100)}%</strong><div className="mini-track"><i className="bar-amber" style={{ width: `${highestRisk.metrics.burst_intensity * 100}%` }} /></div></div>
                    <div><span>Failure rate</span><strong>{Math.round(highestRisk.metrics.failure_rate * 100)}%</strong><div className="mini-track"><i className="bar-red" style={{ width: `${highestRisk.metrics.failure_rate * 100}%` }} /></div></div>
                  </div>
                </>
              ) : (
                <div className="empty-risk"><div className="empty-shield"><ShieldCheck size={27} /></div><strong>Waiting for traffic</strong><span>Send a test request to start your risk assessment.</span></div>
              )}
              <div className="risk-scale"><span>Policy thresholds</span><div className="scale-segments">{POLICY_ORDER.map((policy) => <i key={policy} className={`scale-${policy.toLowerCase()}`} />)}</div><div className="scale-labels"><span>Normal</span><span>Watch</span><span>Throttle</span><span>Block</span></div></div>
            </article>
          </section>

          <section className="panel clients-panel">
            <div className="panel-header clients-heading">
              <div><h2>{activeView === "Events" ? "Recent event stream" : activeView === "Clients" ? "API clients" : "Client activity"}</h2><p>Live health, adaptive policy, and token bucket status per client</p></div>
              <div className="table-actions"><label className="search-box"><Search size={15} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search clients..." /></label><button className="button button-outline" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button></div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>CLIENT</th><th>POLICY STATE</th><th>RISK SCORE</th><th>REQUEST RATE</th><th>FAILURE RATE</th><th>TOKEN BUCKET</th><th>LAST ACTIVITY</th></tr></thead>
                <tbody>
                  {filteredClients.length ? filteredClients.map((client) => {
                    const usage = Math.min(Math.max((10 - client.tokens_remaining) / 10, 0), 1);
                    const latestEvent = events.find((event) => event.client_id === client.client_id);
                    return (
                      <tr key={client.client_id}>
                        <td><button className="client-name" onClick={() => setSelectedClient(client.client_id)}><span className="client-avatar">{client.client_id.slice(0, 2).toUpperCase()}</span><span><strong>{client.client_id}</strong><small>API client</small></span></button></td>
                        <td><StatusPill policy={client.policy} /></td>
                        <td><div className="risk-cell"><span className={`risk-number ${client.risk_score >= 45 ? "risk-high" : client.risk_score >= 25 ? "risk-medium" : ""}`}>{client.risk_score}</span><div className="risk-cell-track"><i className={client.risk_score >= 45 ? "fill-red" : client.risk_score >= 25 ? "fill-amber" : ""} style={{ width: `${client.risk_score}%` }} /></div></div></td>
                        <td><span className="rate-value">{client.metrics.ewma_requests_per_second.toFixed(2)} <small>req/s</small></span></td>
                        <td><span className={client.metrics.failure_rate > 0 ? "failure-value" : "muted-value"}>{Math.round(client.metrics.failure_rate * 100)}%</span></td>
                        <td><div className="token-cell"><span>{client.tokens_remaining.toFixed(1)}<small> / 10</small></span><div className="token-track"><i style={{ width: `${usage * 100}%` }} /></div></div></td>
                        <td><span className="activity-time"><span className={`activity-status ${latestEvent?.outcome ?? "idle"}`} />{latestEvent ? timeAgo(latestEvent.timestamp) : "No activity"}</span></td>
                      </tr>
                    );
                  }) : (
                    <tr><td className="empty-table" colSpan={7}>{searchText ? "No clients match your search." : "No clients yet. Send a test request to get started."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Showing <strong>{filteredClients.length}</strong> of <strong>{status.tracked_clients}</strong> clients</span><span>Risk scores update automatically <span className="footer-live"><i /> LIVE</span></span></div>
          </section>

          <section className="lower-grid">
            <article className="panel simulator-panel">
              <div className="panel-header"><div><h2>Traffic simulator</h2><p>Generate safe test traffic against the local API</p></div><div className="sim-icon"><Zap size={16} /></div></div>
              <label className="field-label" htmlFor="client-id">Test client ID</label>
              <input id="client-id" className="client-input" value={selectedClient} onChange={(event) => setSelectedClient(event.target.value || "demo-client")} maxLength={100} />
              <div className="sim-actions">
                <button className="sim-action" onClick={() => void runAction("normal")} disabled={busy || connection !== "online"}><span className="sim-action-icon sim-green"><Check size={15} /></span><span><strong>Normal request</strong><small>Successful traffic</small></span><ArrowUpRight size={15} /></button>
                <button className="sim-action" onClick={() => void runAction("burst")} disabled={busy || connection !== "online"}><span className="sim-action-icon sim-amber"><Zap size={15} /></span><span><strong>Simulate burst</strong><small>Send 20 rapid requests</small></span><ArrowUpRight size={15} /></button>
                <button className="sim-action" onClick={() => void runAction("failure")} disabled={busy || connection !== "online"}><span className="sim-action-icon sim-red"><Siren size={15} /></span><span><strong>Trigger failure</strong><small>Test failure detection</small></span><ArrowUpRight size={15} /></button>
              </div>
              <div className="sim-footer"><span><LockKeyhole size={13} /> Local development only</span><button onClick={() => void runAction("reset")} disabled={busy || connection !== "online"}><RotateCcw size={13} /> Reset data</button></div>
            </article>

            <article className="panel events-panel">
              <div className="panel-header"><div><h2>Latest events</h2><p>Recent API activity and enforcement actions</p></div><button className="text-link" onClick={() => setActiveView("Events")}>View all <ArrowUpRight size={13} /></button></div>
              <div className="event-list">
                {events.slice(0, 6).map((event, index) => {
                  const outcomeLabel = event.outcome === "success" ? "Request allowed" : event.outcome === "failure" ? "Request failed" : event.outcome === "limited" ? "Rate limited" : "Processing";
                  const EventIcon = event.outcome === "success" ? Check : event.outcome === "failure" ? X : event.outcome === "limited" ? Ban : LoaderCircle;
                  return (
                    <div className="event-item" key={`${event.timestamp}-${event.client_id}-${index}`}>
                      <span className={`event-icon event-${event.outcome}`}><EventIcon size={14} /></span>
                      <span className="event-copy"><strong>{outcomeLabel}</strong><small><b>{event.client_id}</b> · {event.endpoint}</small></span>
                      <span className="event-time">{timeAgo(event.timestamp)}</span>
                    </div>
                  );
                })}
                {!events.length && <div className="empty-events"><Radio size={20} /><span>API events will appear here as traffic arrives.</span></div>}
              </div>
            </article>
          </section>

          <footer className="page-footer"><span>Sentinel Adaptive API Shield <b>v1.0.0</b></span><span>Protected by token bucket + behavioral risk engine</span></footer>
        </div>
      </main>

      {busy && <div className="busy-indicator"><LoaderCircle size={15} /> Running simulator</div>}
      {notice && <div className="toast"><Check size={15} /> {notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div>}
    </div>
  );
}
