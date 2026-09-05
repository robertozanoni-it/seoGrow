import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, PlugZap } from "lucide-react";
import connectorPhp from "../wordpress-plugin/seogrow-connector/seogrow-connector.php?raw";
import "./WordPressConnectorControl.css";

const resolveTarget = () =>
  typeof document === "undefined" ? null : document.querySelector(".wp-live-remediation");

export default function WordPressConnectorControl() {
  const [target, setTarget] = useState(() => resolveTarget());
  const [packaging, setPackaging] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const scan = () => {
      const next = resolveTarget();
      setTarget((current) => current === next ? current : next);
      if (!next && attempts < 120) {
        attempts += 1;
        frame = window.requestAnimationFrame(scan);
      }
    };
    scan();
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!target) return null;

  const downloadConnector = async () => {
    setPackaging(true);
    setMessage("Preparazione Connector…");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      zip.file("seogrow-connector/seogrow-connector.php", connectorPhp);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "seogrow-connector.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setMessage("Connector pronto. Installalo e attivalo una sola volta in WordPress, poi ricarica SeoGrow e riconnetti WordPress.");
    } catch (error) {
      setMessage(`Preparazione Connector non riuscita: ${error.message}`);
    } finally {
      setPackaging(false);
    }
  };

  return createPortal(
    <section className="wp-connector-control" aria-label="SeoGrow Connector per WordPress">
      <div>
        <span className="wp-connector-kicker"><PlugZap /> Adapter Elementor e SEO</span>
        <strong>SeoGrow Connector</strong>
        <small>
          Elementor, Rank Math e Yoast normalmente non espongono tutti i loro campi protetti nella REST API. Il Connector abilita esclusivamente i campi necessari a SeoGrow per l’utente WordPress autenticato.
        </small>
      </div>
      <button type="button" className="secondary" onClick={downloadConnector} disabled={packaging}>
        <Download />{packaging ? "Preparazione…" : "Scarica SeoGrow Connector"}
      </button>
      {message && <p className="integration-result wp-connector-message">{message}</p>}
    </section>,
    target,
  );
}
