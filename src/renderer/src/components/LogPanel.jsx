// components/LogPanel.jsx — Painel de log com auto-scroll

import { useRef, useEffect, useState } from "react";
import { Icons } from '../constants/icons.jsx';

export default function LogPanel({ T, D, logs, onClear }) {
  const scrollRef = useRef(null);
  const [copied, setCopied] = useState(false);

  // Auto-scroll para o final quando novos logs chegam
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const logIcon = (t) => ({
    success: Icons.check(D.success),
    warning: Icons.warn(D.warning),
    error: Icons.error(D.error),
    info: Icons.info(D.info),
  }[t] || Icons.info(D.info));

  const logColor = (t) => ({
    success: D.success,
    warning: D.warning,
    error: D.error,
    info: D.info,
  }[t] || D.info);

  const handleCopy = async () => {
    const prefix = (t) => ({ success: "✓", warning: "⚠", error: "✗", info: "•" }[t] || "•");
    const text = logs.map(l => `${prefix(l.type)} ${l.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para ambientes sem Clipboard API (PyWebView em alguns casos)
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="log-panel" style={{ borderLeft: `1px solid ${D.border}`, background: D.logBg }}>
      <div className="log-header" style={{ borderBottom: `1px solid ${D.borderLight}` }}>
        <span className="log-title" style={{ color: D.textMuted }}>{T.log_title}</span>
        {logs.length > 0 && (
          <div className="log-header-actions">
            <button
              className="log-action-btn"
              onClick={handleCopy}
              style={{ color: copied ? D.success : D.accent }}
              title={T.copy_log}
            >
              {Icons.copy(copied ? D.success : D.accent)}
              <span>{copied ? T.copied : T.copy_log}</span>
            </button>
            <button className="log-clear-btn" onClick={onClear} style={{ color: D.accent }}>
              {T.clear}
            </button>
          </div>
        )}
      </div>
      <div className="log-content" ref={scrollRef}>
        {logs.length === 0
          ? <div className="log-placeholder" style={{ color: D.textMuted }}>{T.log_placeholder}</div>
          : logs.map((l, i) => (
              <div key={i} className="log-line">
                <span className="log-line-icon">{logIcon(l.type)}</span>
                <span style={{ color: logColor(l.type), fontSize: 12 }}>{l.text}</span>
              </div>
            ))
        }
      </div>
    </div>
  );
}
