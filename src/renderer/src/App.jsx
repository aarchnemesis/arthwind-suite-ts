import { useState, useEffect, useCallback } from "react";
import './App.css';
import { translations, GROUP_COLORS } from './constants/translations.js';
import { Icons } from './constants/icons.jsx';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ModuleForm from './components/ModuleForm.jsx';
import LogPanel from './components/LogPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import usePyWebView from './hooks/usePyWebView.js';

// ─── Tema (ainda precisa de D inline pois os componentes SVG usam cores dinâmicas) ──
const themes = {
  dark: {
    bg: "#1a1d23", bgDeep: "#14161b", bgPanel: "#1e2128", bgCard: "#22252e",
    border: "rgba(99,140,200,0.12)", borderLight: "rgba(99,140,200,0.07)",
    accent: "#4e8fd4", accentSoft: "rgba(78,143,212,0.15)", accentSofter: "rgba(78,143,212,0.08)",
    textPrimary: "#e8ecf2", textSecond: "#8c98ac", textMuted: "#4a5568",
    logBg: "#161820", inputBg: "#12141a",
    success: "#34c77b", warning: "#f5a623", error: "#f0554a", info: "#4e8fd4",
  },
  light: {
    bg: "#f7f8fc", bgDeep: "#eef1f7", bgPanel: "#f0f3f9", bgCard: "#ffffff",
    border: "rgba(46,90,160,0.10)", borderLight: "rgba(46,90,160,0.06)",
    accent: "#2e5aa0", accentSoft: "rgba(46,90,160,0.08)", accentSofter: "rgba(46,90,160,0.04)",
    textPrimary: "#1a2333", textSecond: "#4a5c78", textMuted: "#9aaabf",
    logBg: "#f0f3f9", inputBg: "#ffffff",
    success: "#1a9e5c", warning: "#c47d0a", error: "#d63b32", info: "#2e5aa0",
  },
};

export default function ArthwindSuite() {
  const [lang, setLang] = useState("pt");
  const [active, setActive] = useState(1);
  const [options, setOptions] = useState({});
  const [filePaths, setFilePaths] = useState({});
  const [darkMode, setDarkMode] = useState(() => {
    try { return JSON.parse(localStorage.getItem("adark") || "false"); } catch { return false; }
  });
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [gpsRaiz, setGpsRaiz] = useState("");
  const [lastPaths, setLastPaths] = useState(() => {
    try { return JSON.parse(localStorage.getItem("alastpaths") || "{}"); } catch { return {}; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const {
    logs, running, ran, progress, lastOutput,
    gpsLoading, gpsFotos, setGpsFotos,
    bladeSplitLoading, bladeSplitSuspeitos, setBladeSplitSuspeitos,
    fotosReconstruirLoading, fotosReconstruir, setFotosReconstruir,
    clearLogs, handleRun, pickInput,
    carregarFotosGps, carregarBladeSplit, carregarFotosReconstruir,
    goproRawLoading, goproRawRegioes, setGoproRawRegioes, carregarGoproRaw,
    openFolder, isPyWebView,
  } = usePyWebView();

  const D = darkMode ? themes.dark : themes.light;
  const T = translations[lang];
  const module = T.fields[active];

  // Módulos com layout próprio que ocupam a largura total
  // (módulo 18 — Vídeo 360° — arquivado, ver translations.js)
  const isWideModule = active === 11 || active === 16 || active === 17 || active === 19;

  // Info do módulo activo (grupo, ícone)
  const moduleInfo  = T.modules.find(m => m.id === active) || {};
  const groupColor  = GROUP_COLORS[moduleInfo.group] || D.accent;

  // Estado dos passos para o indicador
  const allInputsFilled = module.inputs?.every(inp => !!filePaths[inp.inputId]) ?? true;
  const hasInputs       = (module.inputs?.length ?? 0) > 0;
  const hasOptions      = (module.options?.length ?? 0) > 0;
  const optsDone        = !hasOptions || Object.keys(options).some(k => options[k]);
  const lastRunHadError = ran && !running && logs.some(l => l.type === "error");

  // Carrega configuração de debug, tema e últimos caminhos do backend
  useEffect(() => {
    if (typeof window.pywebview !== "undefined" && window.pywebview.api) {
      window.pywebview.api.get_debug_mode().then(setDebugMode);

      window.pywebview.api.get_theme_mode().then((theme) => {
        if (theme) setDarkMode(theme === "dark");
        setThemeLoaded(true);
      });

      window.pywebview.api.get_last_paths().then((paths) => {
        if (paths) setLastPaths(paths);
      });
    }
  }, [isPyWebView]);

  const handleToggleDebug = async () => {
    const newVal = !debugMode;
    setDebugMode(newVal);
    if (typeof window.pywebview !== "undefined" && window.pywebview.api) {
      await window.pywebview.api.set_debug_mode(newVal);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    try { localStorage.setItem("adark", JSON.stringify(darkMode)); } catch { /* ignore */ }
    if (themeLoaded && typeof window.pywebview !== "undefined" && window.pywebview.api) {
      window.pywebview.api.set_theme_mode(darkMode ? "dark" : "light");
    }
  }, [darkMode, themeLoaded]);

  useEffect(() => {
    try { localStorage.setItem("alastpaths", JSON.stringify(lastPaths)); } catch { /* ignore */ }
    if (typeof window.pywebview !== "undefined" && window.pywebview.api) {
      window.pywebview.api.set_last_paths(lastPaths);
    }
  }, [lastPaths]);

  const toggleLang = useCallback(() => {
    setLang(l => l === "pt" ? "en" : "pt");
    setActive(1); setOptions({}); setFilePaths({});
    clearLogs(); setGpsFotos([]); setGpsRaiz("");
  }, [clearLogs, setGpsFotos]);

  const switchModule = useCallback((id) => {
    setActive(id);
    clearLogs();
    setGpsFotos([]); setGpsRaiz("");
    setFotosReconstruir([]);
    setGoproRawRegioes([]);
    setFilePaths(lastPaths[id] || {});
  }, [clearLogs, lastPaths, setGpsFotos, setFotosReconstruir, setGoproRawRegioes]);

  const updateFilePaths = useCallback((updater) => {
    setFilePaths(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setLastPaths(lp => ({ ...lp, [active]: next }));
      return next;
    });
  }, [active]);

  const onRun = useCallback(() => {
    handleRun(active, filePaths, options, gpsRaiz);
  }, [handleRun, active, filePaths, options, gpsRaiz]);

  // Ctrl+Enter: executar | Ctrl+D: alternar debug
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === "Enter" && !running && module.action) onRun();
      if (e.ctrlKey && e.key === "d") { e.preventDefault(); handleToggleDebug(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, module, onRun]);

  // Monta o indicador de passos
  const renderSteps = () => {
    if (!module.action || module.doc) return null;

    const steps = [];

    if (hasInputs) {
      const done = allInputsFilled;
      const current = !done;
      steps.push(
        <span key="s1" className={`mh-step${done ? " done" : current ? " current" : ""}`}>
          {done ? "✓" : "○"}{" "}
          {module.inputs.length === 1 ? "Selecionar arquivo" : "Selecionar arquivos"}
        </span>
      );
    }

    if (hasOptions) {
      steps.push(<span key="sep1" className="mh-step-sep">›</span>);
      const done = optsDone && (hasInputs ? allInputsFilled : true);
      const current = !done && (hasInputs ? allInputsFilled : true);
      steps.push(
        <span key="s2" className={`mh-step${done ? " done" : current ? " current" : ""}`}>
          {done ? "✓" : "○"} Configurar
        </span>
      );
    }

    if (steps.length > 0) steps.push(<span key="sep2" className="mh-step-sep">›</span>);

    const execDone = ran && !running;
    const execCurrent = !execDone && (hasInputs ? allInputsFilled : true) && (hasOptions ? optsDone : true);
    steps.push(
      <span key="s3" className={`mh-step${execDone ? " done" : execCurrent ? " current" : ""}`}>
        {execDone ? (lastRunHadError ? "✗" : "✓") : "○"} Executar
      </span>
    );

    return <div className="module-steps">{steps}</div>;
  };

  return (
    <div className="app-shell">
      <TopBar
        T={T} D={D} lang={lang}
        darkMode={darkMode} setDarkMode={setDarkMode}
        toggleLang={toggleLang}
      />

      {/* Progress Bar */}
      <div className="progress-container">
        {running && (
          <div className="progress-bar-track">
            {progress < 0
              ? <div className="progress-bar-indeterminate" />
              : <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            }
          </div>
        )}
      </div>

      {/* Body */}
      <div className="body-layout" style={{ position: "relative" }}>
        <Sidebar T={T} D={D} active={active} onSwitch={switchModule} collapsed={sidebarCollapsed} />

        {/* Botão flutuante para recolher/expandir sidebar */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="sidebar-toggle"
          style={{
            position: "absolute",
            left: sidebarCollapsed ? "0" : "208px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "18px",
            height: "48px",
            borderRadius: "0 6px 6px 0",
            border: `1px solid ${D.border}`,
            borderLeft: "none",
            background: D.bgPanel,
            color: D.textSecond,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            transition: "left 0.3s ease, background 0.2s, color 0.2s",
            boxShadow: "1px 0 4px rgba(0,0,0,0.05)",
            padding: 0,
            outline: "none"
          }}
          title={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
        >
          <span style={{ fontSize: "11px", fontWeight: "bold" }}>
            {sidebarCollapsed ? "❯" : "❮"}
          </span>
        </button>

        <div className="main-panel">
          {/* Module Header */}
          <div className="module-header" style={{ background: D.bgDeep, borderBottom: `1px solid ${D.borderLight}` }}>
            <div className="module-header-inner">
              {/* Ícone do módulo */}
              {moduleInfo.icon && Icons[moduleInfo.icon] && (
                <div
                  className="module-header-icon-wrap"
                  style={{ background: `${groupColor}18` }}
                >
                  <div style={{ transform: "scale(1.45)", transformOrigin: "center" }}>
                    {Icons[moduleInfo.icon](groupColor)}
                  </div>
                </div>
              )}

              <div className="module-header-info">
                {/* Tag grupo */}
                {moduleInfo.group && (
                  <div
                    className="module-header-tag"
                    style={{ background: `${groupColor}14`, color: groupColor }}
                  >
                    {moduleInfo.group}
                    {moduleInfo.id && (
                      <span style={{ opacity: 0.65, fontWeight: 600 }}>· M{moduleInfo.id}</span>
                    )}
                  </div>
                )}

                <div className="module-header-title" style={{ color: D.textPrimary }}>
                  {module.title}
                </div>
                <div className="module-header-desc" style={{ color: D.textSecond }}>
                  {module.desc}
                </div>

                {renderSteps()}
              </div>
            </div>
          </div>

          {/* Form + Log lado a lado */}
          <div className="form-log-container">
            <div className="form-scroll-area">
              <ModuleForm
                T={T} D={D} lang={lang} active={active} module={module}
                filePaths={filePaths} setFilePaths={updateFilePaths}
                options={options} setOptions={setOptions}
                running={running} ran={ran} lastOutput={lastOutput}
                ranHadError={lastRunHadError}
                onReset={clearLogs}
                isWideModule={isWideModule}
                gpsLoading={gpsLoading} gpsFotos={gpsFotos}
                gpsRaiz={gpsRaiz} setGpsRaiz={setGpsRaiz}
                bladeSplitLoading={bladeSplitLoading} bladeSplitSuspeitos={bladeSplitSuspeitos}
                setBladeSplitSuspeitos={setBladeSplitSuspeitos}
                fotosReconstruirLoading={fotosReconstruirLoading} fotosReconstruir={fotosReconstruir}
                goproRawLoading={goproRawLoading} goproRawRegioes={goproRawRegioes}
                onPickInput={pickInput} onCarregarGps={carregarFotosGps}
                onCarregarBladeSplit={carregarBladeSplit} onCarregarFotosReconstruir={carregarFotosReconstruir}
                onCarregarGoproRaw={carregarGoproRaw}
                onRun={onRun} onOpenFolder={openFolder}
                isPyWebView={isPyWebView}
              />
            </div>

            {!module.doc && !isWideModule && (
              <LogPanel T={T} D={D} logs={logs} onClear={clearLogs} />
            )}
          </div>
        </div>
      </div>

      <StatusBar T={T} D={D} active={active} running={running} progress={progress} />
    </div>
  );
}
