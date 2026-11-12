import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Lock, LogOut, ShieldCheck } from "lucide-react";
import { useParams } from "react-router-dom";

type ClawItem = {
  id: string;
  name: string;
  price: string;
  priceLabel: string;
  powerBonus: number;
  color: string;
  accent: string;
  owned: boolean;
  equipped: boolean;
};

type Garage = {
  chicken: {
    name: string;
    level: number;
    aggression: number;
    claws: number;
    comb: number;
    kickPower: number;
    wins: number;
    losses: number;
  };
  balance: string;
  balanceLabel: string;
  equippedItem: string;
  equippedName: string;
  items: ClawItem[];
};

async function chickenRequest<T>(token: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/chicken/${encodeURIComponent(token)}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Không thể xử lý yêu cầu") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export function ChickenGarage() {
  const { token = "" } = useParams();
  const [garage, setGarage] = useState<Garage | null>(null);
  const [mode, setMode] = useState<"loading" | "setup" | "login" | "garage" | "invalid">("loading");
  const [chickenName, setChickenName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imageVersion, setImageVersion] = useState(0);

  const loadGarage = useCallback(async () => {
    const data = await chickenRequest<Garage>(token, "/garage");
    setGarage(data);
    setSelected((current) => current || (data.equippedItem !== "bare" ? data.equippedItem : data.items[0]?.id) || "");
    setMode("garage");
    return data;
  }, [token]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await chickenRequest<{ pinConfigured: boolean; chickenName: string }>(token, "/status");
        if (!alive) return;
        setChickenName(status.chickenName);
        try {
          await loadGarage();
        } catch (cause) {
          if (!alive) return;
          const statusCode = (cause as Error & { status?: number }).status;
          if (statusCode !== 401) throw cause;
          setMode(status.pinConfigured ? "login" : "setup");
        }
      } catch {
        if (alive) setMode("invalid");
      }
    })();
    return () => { alive = false; };
  }, [loadGarage, token]);

  const selectedItem = useMemo(
    () => garage?.items.find((item) => item.id === selected) ?? null,
    [garage, selected],
  );

  async function submitPin(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "setup" && pin !== confirmPin) {
      setError("Hai lần nhập PIN chưa khớp");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await chickenRequest(token, mode === "setup" ? "/setup" : "/login", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      await loadGarage();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function buyOrEquip() {
    if (!selectedItem) return;
    setBusy(true);
    setError("");
    try {
      const data = await chickenRequest<Garage>(token, `/equipment/${selectedItem.id}`, { method: "POST" });
      setGarage(data);
      setImageVersion((value) => value + 1);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") return <GarageState title="Đang mở garage" detail="Đang kiểm tra liên kết riêng của bạn." />;
  if (mode === "invalid") return <GarageState title="Liên kết không hợp lệ" detail="Hãy dùng lại lệnh /ga trong nhóm Zalo để lấy đúng đường dẫn." />;
  if (mode === "setup" || mode === "login") {
    const firstVisit = mode === "setup";
    return (
      <main className="garage-auth">
        <section className="garage-auth-copy">
          <GarageBrand />
          <h1>{chickenName}</h1>
          <p>{firstVisit ? "Garage riêng. Đặt PIN số cho lần mở đầu tiên. Link này không hiển thị Zalo ID của bạn." : "Garage riêng. Nhập PIN để xem và thay móng cho chiến kê."}</p>
        </section>
        <form className="garage-pin-panel" onSubmit={submitPin}>
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2>{firstVisit ? "Tạo PIN" : "Mở garage"}</h2>
            <p>{firstVisit ? "Từ 4 đến 12 chữ số, chỉ đặt một lần." : "PIN chỉ được kiểm tra ở máy chủ."}</p>
          </div>
          <label>
            PIN số
            <input autoFocus type="password" inputMode="numeric" pattern="[0-9]*" minLength={4} maxLength={12} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} autoComplete={firstVisit ? "new-password" : "current-password"} />
          </label>
          {firstVisit && (
            <label>
              Nhập lại PIN
              <input type="password" inputMode="numeric" pattern="[0-9]*" minLength={4} maxLength={12} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ""))} autoComplete="new-password" />
            </label>
          )}
          {error && <p className="garage-error">{error}</p>}
          <button disabled={busy || pin.length < 4 || (firstVisit && confirmPin.length < 4)}>
            {busy ? "Đang xác thực…" : firstVisit ? "Khóa garage bằng PIN" : "Vào garage"}
            <ChevronRight size={17} />
          </button>
        </form>
      </main>
    );
  }

  if (!garage) return null;
  const preview = selected || garage.equippedItem;
  return (
    <div className="chicken-garage">
      <header className="garage-topbar">
        <GarageBrand />
        <div className="garage-scope">
          <span>{garage.chicken.name}</span>
          <small>Level {garage.chicken.level}</small>
        </div>
        <button className="garage-logout" onClick={async () => {
          await chickenRequest(token, "/logout", { method: "POST" });
          setMode("login");
          setGarage(null);
        }}><LogOut size={16} /> Thoát</button>
      </header>

      <main className="garage-workspace">
        <section className="garage-preview" aria-label="Xem trước chiến kê">
          <div className="garage-image-frame">
            <img src={`/api/chicken/${encodeURIComponent(token)}/image?preview=${encodeURIComponent(preview)}&v=${imageVersion}`} alt={`${garage.chicken.name} đang mang ${selectedItem?.name ?? garage.equippedName}`} />
          </div>
          <div className="garage-stat-strip">
            <div><span>Độ sung</span><strong>{garage.chicken.aggression.toLocaleString("vi-VN")}</strong></div>
            <div><span>Móng gà</span><strong>{garage.chicken.claws.toLocaleString("vi-VN")}</strong></div>
            <div><span>Mào gà</span><strong>{garage.chicken.comb.toLocaleString("vi-VN")}</strong></div>
            <div><span>Lực đá</span><strong>{garage.chicken.kickPower.toLocaleString("vi-VN")}</strong></div>
          </div>
        </section>

        <aside className="garage-equipment">
          <div className="garage-balance">
            <div>
              <span>Số dư dùng chung</span>
              <strong>{garage.balanceLabel}</strong>
            </div>
            <small>Đang mang<br /><b>{garage.equippedName}</b></small>
          </div>
          <div className="garage-list-head">
            <div><h1>Kho móng</h1><p>Chọn một món để xem trực tiếp trên gà.</p></div>
            <span>{garage.items.filter((item) => item.owned).length}/{garage.items.length}</span>
          </div>
          <div className="claw-list">
            {garage.items.map((item) => (
              <button key={item.id} className={`claw-row ${selected === item.id ? "selected" : ""}`} onClick={() => setSelected(item.id)}>
                <i style={{ background: item.color }} aria-hidden="true" />
                <span><b>{item.name}</b><small>+{item.powerBonus.toLocaleString("vi-VN")} lực chiến</small></span>
                <span className="claw-state">
                  {item.equipped ? <><Check size={14} /> Đang mang</> : item.owned ? "Đã sở hữu" : <><Lock size={13} /> {item.priceLabel}</>}
                </span>
              </button>
            ))}
          </div>
          {error && <p className="garage-error">{error}</p>}
          <button className="garage-primary" disabled={busy || !selectedItem || selectedItem.equipped} onClick={buyOrEquip}>
            {busy ? "Đang đồng bộ…" : selectedItem?.equipped ? "Đang trang bị" : selectedItem?.owned ? `Trang bị ${selectedItem.name}` : `Mua ${selectedItem?.name} · ${selectedItem?.priceLabel}`}
          </button>
          <p className="garage-sync-note">Mua đồ sẽ trừ ngay số dư đang dùng trên Zalo. Trang bị lại món đã mua không tốn thêm tiền.</p>
        </aside>
      </main>
    </div>
  );
}

function GarageBrand() {
  return <div className="garage-brand"><span>ML</span><b>MbaLong</b></div>;
}

function GarageState({ title, detail }: { title: string; detail: string }) {
  return <main className="garage-state"><GarageBrand /><div /><h1>{title}</h1><p>{detail}</p></main>;
}
