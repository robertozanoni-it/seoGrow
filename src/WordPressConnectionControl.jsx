import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plug, XCircle } from "lucide-react";
import { apiFetch } from "./api";

const resolveTarget = () =>
  typeof document === "undefined"
    ? null
    : document.querySelector(".audit-unified-credentials");

const readCredentials = (target) => {
  const inputs = [...(target?.querySelectorAll("input") || [])];
  const url = inputs.find((input) => input.autocomplete === "url")?.value?.trim() || "";
  const username =
    inputs.find((input) => input.autocomplete === "username")?.value?.trim() || "";
  const applicationPassword =
    inputs.find((input) => input.type === "password")?.value || "";
  return { url, username, applicationPassword };
};

export default function WordPressConnectionControl() {
  const [target, setTarget] = useState(() => resolveTarget());
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setTarget((current) => {
      const next = resolveTarget();
      return current === next ? current : next;
    });
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(sync, 0);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!target) return undefined;
    const update = () => {
      const credentials = readCredentials(target);
      setReady(Boolean(credentials.url && credentials.username && credentials.applicationPassword));
      setStatus((current) =>
        current.state === "idle" ? current : { state: "idle", message: "" },
      );
    };
    const timer = window.setTimeout(update, 0);
    target.addEventListener("input", update);
    return () => {
      window.clearTimeout(timer);
      target.removeEventListener("input", update);
    };
  }, [target]);

  if (!target) return null;

  const connect = async () => {
    const credentials = readCredentials(target);
    if (!credentials.url || !credentials.username || !credentials.applicationPassword) {
      setStatus({
        state: "error",
        message: "Inserisci URL, utente e password applicativa WordPress.",
      });
      return;
    }

    setConnecting(true);
    setStatus({ state: "loading", message: "Connessione a WordPress in corso…" });
    try {
      const response = await apiFetch("/api/wordpress/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Connessione WordPress non riuscita.");
      const name = data?.user?.name ? ` come ${data.user.name}` : "";
      setStatus({
        state: "success",
        message: `Connessione WordPress riuscita${name}. Le credenziali sono valide per questa sessione.`,
      });
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Connessione WordPress non riuscita.",
      });
    } finally {
      setConnecting(false);
    }
  };

  return createPortal(
    <div className="inline-actions wordpress-connection-control">
      <button
        type="button"
        className="primary"
        onClick={connect}
        disabled={!ready || connecting}
      >
        {status.state === "success" ? <Check /> : <Plug />}
        {connecting ? "Connessione…" : status.state === "success" ? "Connesso" : "Connetti WordPress"}
      </button>
      {status.message && (
        <span
          className={status.state === "error" ? "error" : "integration-result"}
          role={status.state === "error" ? "alert" : "status"}
        >
          {status.state === "error" && <XCircle aria-hidden="true" />} {status.message}
        </span>
      )}
    </div>,
    target,
  );
}
