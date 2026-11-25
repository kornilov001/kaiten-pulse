import { useState } from "react";
import { connect, type KaitenUser } from "../lib/kaiten";
import { openUrl } from "../lib/platform";

export function Onboarding({ onConnected }: { onConnected: (u: KaitenUser) => void }) {
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const host = domain.trim() ? (domain.includes(".") ? domain.trim().replace(/^https?:\/\//, "").split("/")[0] : `${domain.trim()}.kaiten.ru`) : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onConnected(await connect(domain, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col h-full px-5 pt-8 pb-5">
      <h1 className="text-[20px] font-semibold leading-tight">Подключите Kaiten</h1>
      <p className="mt-2 text-muted text-[13px] max-w-[34ch]">
        Kaiten Pulse покажет ваши карточки со сроками и напомнит о них. Токен хранится в системной связке ключей.
      </p>

      <label className="mt-6 text-[12px] text-muted" htmlFor="domain">Адрес вашего Kaiten</label>
      <input
        id="domain"
        autoFocus
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="company.kaiten.ru"
        className="mt-1 h-9 px-3 rounded-lg bg-paper border border-line outline-none focus:border-accent"
      />

      <label className="mt-4 text-[12px] text-muted" htmlFor="token">API-токен</label>
      <input
        id="token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="mt-1 h-9 px-3 rounded-lg bg-paper border border-line outline-none focus:border-accent"
      />
      <button
        type="button"
        disabled={!host}
        onClick={() => openUrl(`https://${host}/profile/api-key`)}
        className="mt-1.5 self-start text-[12px] text-accent disabled:text-faint hover:underline"
      >
        {host ? `Создать токен на ${host}` : "Сначала укажите адрес — дадим ссылку на страницу токена"}
      </button>

      {error && <p role="alert" className="mt-4 text-[12.5px] text-overdue">{error}</p>}

      <button
        type="submit"
        disabled={busy || !domain.trim() || !token.trim()}
        className="mt-auto h-10 rounded-lg bg-accent text-white font-medium disabled:opacity-40"
      >
        {busy ? "Проверяю…" : "Подключить"}
      </button>
    </form>
  );
}
