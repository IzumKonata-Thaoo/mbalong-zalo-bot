import { useCallback, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleUserRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wifi,
  WifiOff,
  X,
  UserPlus,
  Trash2,
} from "lucide-react";
import { api } from "./api";

type Zalo = {
  status: string;
  ownId: string;
  accountName: string;
  lastError: string;
};
type Group = {
  id: string;
  name: string;
  enabled: number;
  member_count: number;
  last_seen_at: string | null;
};
type Dashboard = {
  stats: {
    groups: number;
    activeGroups: number;
    members: number;
    messages: number;
  };
  zalo: Zalo;
  groups: Group[];
  audits: Audit[];
};
type Audit = {
  id: number;
  action: string;
  target: string;
  actor_id: string;
  created_at: string;
};

export function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  useEffect(() => {
    api("/auth/me")
      .then(() => setAuth(true))
      .catch(() => setAuth(false));
    const fn = () => setAuth(false);
    addEventListener("auth:expired", fn);
    return () => removeEventListener("auth:expired", fn);
  }, []);
  if (auth === null) return <Splash />;
  if (!auth) return <Login onDone={() => setAuth(true)} />;
  return <Shell onLogout={() => setAuth(false)} />;
}
function Splash() {
  return (
    <div className="splash">
      <div className="brand-mark">
        <Sparkles />
      </div>
      <span>Đang mở MbaLong Console</span>
    </div>
  );
}
function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-copy">
        <div className="wordmark">
          <span className="brand-mark">
            <Sparkles />
          </span>
          MBALONG
        </div>
        <p className="eyebrow">ZALO INTELLIGENCE LAYER</p>
        <h1>
          Mọi cuộc trò chuyện,
          <br />
          <em>được hiểu đúng.</em>
        </h1>
        <p className="lede">
          Một trợ lý AI yên tĩnh trong nhóm — chỉ xuất hiện khi được gọi tên.
        </p>
        <div className="login-orbit">
          <div />
          <div />
          <div />
        </div>
      </section>
      <form className="login-card" onSubmit={submit}>
        <div className="mini-icon">
          <ShieldCheck />
        </div>
        <h2>Chào mừng trở lại</h2>
        <p>Đăng nhập vào không gian quản trị riêng tư.</p>
        <label>
          Mật khẩu quản trị
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>
          {busy ? "Đang xác thực…" : "Mở bảng điều khiển"}
          <ArrowRight size={17} />
        </button>
        <small>Phiên được mã hóa · Tự hết hạn sau 12 giờ</small>
      </form>
    </main>
  );
}
function Shell({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    onLogout();
  }
  return (
    <div className="app-shell">
      <aside className={open ? "open" : ""}>
        <div className="wordmark">
          <span className="brand-mark">
            <Sparkles />
          </span>
          MBALONG
          <button className="close-mobile" onClick={() => setOpen(false)}>
            <X />
          </button>
        </div>
        <nav>
          <span>KHÔNG GIAN</span>
          <NavLink to="/" end>
            <LayoutDashboard />
            Tổng quan
          </NavLink>
          <NavLink to="/groups">
            <UsersRound />
            Nhóm & thành viên
          </NavLink>
          <NavLink to="/activity">
            <Activity />
            Hoạt động
          </NavLink>
          <span>HỆ THỐNG</span>
          <NavLink to="/settings">
            <Settings />
            Cấu hình
          </NavLink>
        </nav>
        <div className="side-foot">
          <div className="secure">
            <ShieldCheck />
            <div>
              <b>Chế độ riêng tư</b>
              <small>Không phản hồi tin nhắn riêng</small>
            </div>
          </div>
          <button className="logout" onClick={logout}>
            <LogOut />
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="content">
        <header>
          <button className="menu" onClick={() => setOpen(true)}>
            <Menu />
          </button>
          <div>
            <span>AI CONSOLE</span>
            <b>Trợ lý nhóm Zalo</b>
          </div>
          <div className="header-chip">
            <span />
            Private by design
          </div>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupDetail />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
function Dashboard() {
  const [data, setData] = useState<Dashboard>();
  const load = useCallback(
    () => api<Dashboard>("/dashboard").then(setData),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);
  if (!data) return <PageLoader />;
  const cards = [
    {
      label: "Nhóm đã cho phép",
      value: data.stats.activeGroups,
      sub: `${data.stats.groups} nhóm đã thấy`,
      icon: <UsersRound />,
    },
    {
      label: "Thành viên",
      value: data.stats.members,
      sub: "Đã đồng bộ hồ sơ",
      icon: <CircleUserRound />,
    },
    {
      label: "Tin đã ghi nhớ",
      value: data.stats.messages,
      sub: "Dùng cho ngữ cảnh",
      icon: <MessageSquareText />,
    },
  ];
  return (
    <div className="page">
      <div className="hero">
        <div>
          <p className="eyebrow">TỔNG QUAN HỆ THỐNG</p>
          <h1>Chào buổi sáng, Admin.</h1>
          <p>MbaLong đang lắng nghe đúng nơi — và im lặng ở mọi nơi khác.</p>
        </div>
        <Status zalo={data.zalo} />
      </div>
      <div className="stat-grid">
        {cards.map((c) => (
          <article className="stat" key={c.label}>
            <div className="stat-icon">{c.icon}</div>
            <div>
              <span>{c.label}</span>
              <strong>{c.value.toLocaleString("vi")}</strong>
              <small>{c.sub}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="two-col">
        <section className="panel">
          <PanelTitle
            title="Nhóm gần đây"
            sub="Bật hoặc tắt quyền phản hồi"
            action={
              <NavLink to="/groups">
                Xem tất cả <ChevronRight />
              </NavLink>
            }
          />
          {data.groups.length ? (
            <div className="group-list">
              {data.groups.map((g) => (
                <GroupRow key={g.id} group={g} onChange={load} />
              ))}
            </div>
          ) : (
            <Empty text="Đăng nhập Zalo và gửi một tin nhắn trong group để MbaLong khám phá nhóm." />
          )}
        </section>
        <section className="panel">
          <PanelTitle title="Hoạt động mới" sub="Nhật ký thay đổi quản trị" />
          {data.audits.length ? (
            <div className="timeline">
              {data.audits.map((a) => (
                <div key={a.id}>
                  <span />
                  <div>
                    <b>{actionName(a.action)}</b>
                    <small>
                      {a.target || "Hệ thống"} · {prettyDate(a.created_at)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Chưa có thay đổi quản trị." />
          )}
        </section>
      </div>
      <section className="principle">
        <div className="mini-icon">
          <Sparkles />
        </div>
        <div>
          <b>Quiet intelligence</b>
          <p>
            MbaLong chỉ phản hồi khi tài khoản bot được tag trực tiếp trong nhóm
            đã duyệt. Tin nhắn riêng luôn bị bỏ qua trước khi chạm vào AI.
          </p>
        </div>
      </section>
    </div>
  );
}
function Status({ zalo }: { zalo: Zalo }) {
  const online = zalo.status === "online";
  return (
    <div className={`status-card ${online ? "online" : ""}`}>
      <div>{online ? <Wifi /> : <WifiOff />}</div>
      <section>
        <span>KẾT NỐI ZALO</span>
        <b>
          {online
            ? zalo.accountName || "Đang hoạt động"
            : statusName(zalo.status)}
        </b>
        <small>
          {online
            ? `ID ${zalo.ownId}`
            : zalo.lastError || "Chờ quét QR ở terminal"}
        </small>
      </section>
      <i />
    </div>
  );
}
function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => api<Group[]>("/groups").then(setGroups), []);
  useEffect(() => {
    load();
  }, [load]);
  const visible = groups.filter((g) =>
    (g.name + g.id).toLowerCase().includes(q.toLowerCase()),
  );
  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/groups", {
        method: "POST",
        body: JSON.stringify({ id: groupId }),
      });
      setGroupId("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="page">
      <PageHead
        eyebrow="QUẢN LÝ TRUY CẬP"
        title="Nhóm & thành viên"
        sub="Chọn chính xác nơi MbaLong được phép lên tiếng."
      />
      <form className="add-group" onSubmit={addGroup}>
        <div>
          <b>Thêm group bằng ID</b>
          <span>Chỉ admin web có thể đưa group vào hệ thống.</span>
        </div>
        <input
          value={groupId}
          onChange={(e) => setGroupId(e.target.value.replace(/\D/g, ""))}
          placeholder="Nhập Zalo Group ID"
        />
        <button disabled={!groupId}>
          <UserPlus />
          Thêm group
        </button>
      </form>
      {error && <div className="error group-error">{error}</div>}
      <div className="toolbar">
        <div className="search">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm tên hoặc ID nhóm…"
          />
        </div>
        <button className="secondary" onClick={load}>
          <RefreshCw />
          Đồng bộ
        </button>
      </div>
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Nhóm</th>
              <th>Thành viên</th>
              <th>Lần thấy cuối</th>
              <th>Cho phép bot</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.id}>
                <td>
                  <div className="group-ident">
                    <span>{initials(g.name)}</span>
                    <div>
                      <b>{g.name}</b>
                      <small>{g.id}</small>
                    </div>
                  </div>
                </td>
                <td>{g.member_count.toLocaleString("vi")}</td>
                <td>{g.last_seen_at ? prettyDate(g.last_seen_at) : "—"}</td>
                <td>
                  <Toggle
                    checked={!!g.enabled}
                    onChange={async (v) => {
                      await api(`/groups/${g.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ enabled: v }),
                      });
                      load();
                    }}
                  />
                </td>
                <td>
                  <NavLink className="round-link" to={`/groups/${g.id}`}>
                    <ChevronRight />
                  </NavLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <Empty text="Không tìm thấy nhóm phù hợp." />}
      </section>
    </div>
  );
}
function GroupDetail() {
  const { id } = useParams();
  const [members, setMembers] = useState<any[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newId, setNewId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setMembers(await api(`/groups/${id}/members`));
    setGroups(await api("/groups"));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  const group = groups.find((g) => g.id === id);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/groups/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ id: newId }),
      });
      setNewId("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="page">
      <PageHead
        eyebrow="THÀNH VIÊN NHÓM"
        title={group?.name || "Đang tải…"}
        sub={`ID ${id}`}
      />
      <div className="two-col detail">
        <section className="panel">
          <PanelTitle
            title={`Thành viên (${members.length})`}
            sub="ID thật được lấy trực tiếp từ Zalo"
            action={
              <button
                className="text-btn"
                onClick={async () => {
                  await api(`/groups/${id}/refresh`, { method: "POST" });
                  load();
                }}
              >
                <RefreshCw />
                Làm mới
              </button>
            }
          />
          <div className="member-list">
            {members.map((m) => (
              <div key={m.zalo_id}>
                <span className="avatar">{initials(m.display_name)}</span>
                <section>
                  <b>{m.display_name}</b>
                  <small>
                    {m.zalo_id} · {m.role}
                  </small>
                </section>
                <button
                  className="danger-icon"
                  title="Xóa khỏi nhóm"
                  onClick={async () => {
                    if (confirm(`Xóa ${m.display_name} khỏi nhóm?`)) {
                      try {
                        await api(`/groups/${id}/members/${m.zalo_id}`, {
                          method: "DELETE",
                        });
                        load();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className="panel invite">
          <div className="mini-icon">
            <UserPlus />
          </div>
          <h3>Mời thành viên</h3>
          <p>
            Nhập Zalo ID. Tài khoản bot phải có quyền mời thành viên trong nhóm.
          </p>
          <form onSubmit={add}>
            <label>
              Zalo ID
              <input
                value={newId}
                onChange={(e) => setNewId(e.target.value.replace(/\D/g, ""))}
                placeholder="Ví dụ: 123456789"
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button disabled={!newId}>
              Gửi lời mời <ArrowRight />
            </button>
          </form>
          <div className="hint">
            <BookOpen />
            <span>
              <b>Cách lấy ID</b>Danh sách bên trái hiển thị ID thật sau khi nhấn
              “Làm mới”.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
function ActivityPage() {
  const [items, setItems] = useState<Audit[]>([]);
  useEffect(() => {
    api<Audit[]>("/audit").then(setItems);
  }, []);
  return (
    <div className="page">
      <PageHead
        eyebrow="AUDIT TRAIL"
        title="Nhật ký hoạt động"
        sub="Mọi thay đổi quan trọng đều để lại dấu vết."
      />
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Hành động</th>
              <th>Đối tượng</th>
              <th>Tác nhân</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>{prettyDate(a.created_at)}</td>
                <td>
                  <span className="action-pill">{actionName(a.action)}</span>
                </td>
                <td>{a.target || "—"}</td>
                <td>{a.actor_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="Chưa có hoạt động nào." />}
      </section>
    </div>
  );
}
function SettingsPage() {
  const [cfg, setCfg] = useState<any>();
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [format, setFormat] = useState("openai");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<any>("/config").then((data) => {
      setCfg(data);
      setBaseUrl(data.ai.baseUrl);
      setModel(data.ai.model);
      setFormat(data.ai.format ?? "openai");
      setSystemPrompt(data.ai.systemPrompt ?? "");
    });
  }, []);
  if (!cfg) return <PageLoader />;
  function applyDeepSeekPreset() {
    setFormat("openai");
    setBaseUrl("https://api.deepseek.com");
    setModel("deepseek-flash");
  }
  async function saveAndTest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const saved = await api<any>("/config/ai", {
        method: "PUT",
        body: JSON.stringify({
          baseUrl,
          model,
          format,
          systemPrompt,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      setApiKey("");
      setCfg({ ...cfg, ai: saved });
      setMsg("Đã lưu. Đang kiểm tra kết nối…");
      const test = await api<{ latencyMs: number; response: string }>(
        "/config/ai/test",
        { method: "POST" },
      );
      setMsg(`Kết nối thành công · ${test.latencyMs} ms · ${test.response}`);
    } catch (e) {
      setError((e as Error).message);
      setMsg("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <PageHead
        eyebrow="HỆ THỐNG"
        title="Cấu hình"
        sub="MbaLong hỗ trợ DeepSeek qua OpenAI-compatible, cùng Anthropic và Gemini native."
      />
      <form className="panel ai-config" onSubmit={saveAndTest}>
        <div className="config-heading">
          <div className="mini-icon">
            <Sparkles />
          </div>
          <div>
            <h3>AI Provider</h3>
            <p>Chọn đúng định dạng API, không phụ thuộc tên model.</p>
          </div>
          <button
            type="button"
            className="provider-preset"
            onClick={applyDeepSeekPreset}
          >
            Điền nhanh DeepSeek
          </button>
          <span className={cfg.ai.hasApiKey ? "configured" : "not-configured"}>
            {cfg.ai.hasApiKey
              ? `Đã có key ${cfg.ai.apiKeyHint}`
              : cfg.ai.keyError
                ? "Key lỗi — hãy nhập lại"
                : "Chưa có API key"}
          </span>
        </div>
        <div className="config-fields four">
          <label>
            Định dạng API
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic native</option>
              <option value="gemini">Gemini native</option>
            </select>
          </label>
          <label>
            Base URL
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            Model
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Tên model của provider"
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                cfg.ai.hasApiKey
                  ? "Để trống để giữ key hiện tại"
                  : "Nhập API key"
              }
            />
            <small>
              {cfg.ai.hasApiKey
                ? "Chỉ nhập khi muốn thay khóa."
                : "Khóa được mã hóa trước khi lưu."}
            </small>
          </label>
        </div>
        <label className="system-prompt">
          System prompt tùy chỉnh
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            maxLength={10000}
            placeholder="Ví dụ: Trả lời dí dỏm, ưu tiên câu ngắn, gọi người dùng là bạn…"
          />
          <small>
            {systemPrompt.length.toLocaleString("vi-VN")}/10.000 ký tự · Không
            thể ghi đè chính sách an toàn của ứng dụng.
          </small>
        </label>
        {error && <div className="error">{error}</div>}
        {msg && <div className="save-message">{msg}</div>}
        <button className="save-config" disabled={busy || !baseUrl || !model}>
          {busy ? "Đang lưu và kiểm tra…" : "Lưu & kiểm tra kết nối"}
          <ArrowRight />
        </button>
      </form>
      <div className="settings-grid secondary-settings">
        <section className="panel setting-card">
          <div className="mini-icon">
            <Search />
          </div>
          <h3>Web research</h3>
          <p>
            Search API hiện{" "}
            {cfg.searchEnabled ? "đã được cấu hình" : "chưa được cấu hình"} qua
            biến môi trường trên máy chủ.
          </p>
          <span className={cfg.searchEnabled ? "good" : "muted"}>
            {cfg.searchEnabled ? "Đang hoạt động" : "SEARCH_API_KEY trống"}
          </span>
        </section>
        <section className="panel setting-card">
          <div className="mini-icon">
            <ShieldCheck />
          </div>
          <h3>Quyền quản trị Zalo</h3>
          <p>
            Admin ID được đọc từ <code>ZALO_ADMIN_IDS</code> trong{" "}
            <code>.env</code>.
          </p>
          <div className="id-stack">
            {cfg.adminIds.length ? (
              cfg.adminIds.map((x: string) => <span key={x}>{x}</span>)
            ) : (
              <em>Chưa khai báo ID</em>
            )}
          </div>
        </section>
        <section className="panel setting-card danger-zone">
          <div className="mini-icon">
            <RefreshCw />
          </div>
          <h3>Đăng nhập lại Zalo</h3>
          <p>
            Ngắt phiên hiện tại và in QR mới ở terminal. Chỉ dùng khi session
            hết hạn.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await api("/zalo/relogin", { method: "POST" });
              setMsg("Đã yêu cầu QR mới. Kiểm tra terminal.");
            }}
          >
            Tạo QR mới
          </button>
        </section>
      </div>
    </div>
  );
}

function PageHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="page-head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
}
function PanelTitle({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-title">
      <div>
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
      {action}
    </div>
  );
}
function GroupRow({ group, onChange }: { group: Group; onChange: () => void }) {
  return (
    <div className="group-row">
      <div className="group-avatar">{initials(group.name)}</div>
      <section>
        <b>{group.name}</b>
        <small>
          {group.member_count} thành viên · {group.id}
        </small>
      </section>
      <Toggle
        checked={!!group.enabled}
        onChange={async (v) => {
          await api(`/groups/${group.id}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: v }),
          });
          onChange();
        }}
      />
    </div>
  );
}
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      aria-label={checked ? "Tắt" : "Bật"}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <MessageSquareText />
      <p>{text}</p>
    </div>
  );
}
function PageLoader() {
  return (
    <div className="page-loader">
      <RefreshCw />
      Đang tải dữ liệu…
    </div>
  );
}
const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
const prettyDate = (s: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(s.replace(" ", "T") + (/Z|[+-]\d/.test(s) ? "" : "Z")));
const ACTION_NAMES: Record<string, string> = {
  "group.add": "Thêm group",
  "group.enable": "Bật phản hồi nhóm",
  "group.disable": "Tắt phản hồi nhóm",
  "member.add": "Mời thành viên",
  "member.remove": "Xóa thành viên",
};
const actionName = (s: string) => ACTION_NAMES[s] ?? s;
const statusName = (s: string) =>
  ({
    offline: "Ngoại tuyến",
    connecting: "Đang kết nối",
    qr: "Chờ quét QR",
    error: "Có lỗi",
  })[s] || s;
