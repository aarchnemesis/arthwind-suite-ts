// components/SnowAutomationModule.jsx
// Automação do "Create Damage Report Entry" na plataforma SNOW — lê a planilha já
// gerada pelo SNOW Processor (módulo 23) e preenche o formulário via navegador
// controlado (Playwright). Sessão de login fica salva num perfil persistente, não
// precisa logar de novo a cada execução (só quando a sessão expirar de verdade).

import { useState, useEffect, useRef } from 'react';

const MAX_LOGS = 800;

export default function SnowAutomationModule({ D }) {
  const [excelPath, setExcelPath] = useState('');
  const [localPhotosDir, setLocalPhotosDir] = useState('');
  const [incidentUrl, setIncidentUrl] = useState('');
  const [headless, setHeadless] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [includeBlankImages, setIncludeBlankImages] = useState(false);
  const [skipSubmitted, setSkipSubmitted] = useState(true);
  const [processOnlyVideos, setProcessOnlyVideos] = useState(false);
  const [startRow, setStartRow] = useState('');
  const [endRow, setEndRow] = useState('');


  const [blades, setBlades] = useState([]);
  const [selectedBlades, setSelectedBlades] = useState([]);
  const [loadingBlades, setLoadingBlades] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const logsEndRef = useRef(null);



  useEffect(() => {
    const handleLog = (e) => {
      const { msg } = e.detail || {};
      if (!msg) return;
      const type = msg.startsWith('✗') ? 'error' : msg.startsWith('✓') ? 'success' : 'info';
      setLogs((prev) => {
        const next = [...prev, { text: msg, type }];
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
      });
    };
    window.addEventListener('snow_automation_log', handleLog);
    return () => window.removeEventListener('snow_automation_log', handleLog);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const loadBlades = async (path) => {
    if (!path) return;
    setLoadingBlades(true);
    try {
      const res = await window.pywebview.api.snow_automation_get_blades(path);
      if (res.success && Array.isArray(res.blades)) {
        setBlades(res.blades);
        setSelectedBlades(res.blades.map((b) => b.bladeSerialNumber));
      } else {
        setBlades([]);
        setSelectedBlades([]);
      }
    } catch {
      setBlades([]);
      setSelectedBlades([]);
    } finally {
      setLoadingBlades(false);
    }
  };

  const pickExcel = async () => {
    const picked = await window.pywebview.api.pick_file('xlsx');
    if (picked) {
      setExcelPath(picked);
      loadBlades(picked);
      const lastSlash = Math.max(picked.lastIndexOf('\\'), picked.lastIndexOf('/'));
      if (lastSlash > -1) {
        const folder = picked.substring(0, lastSlash);
        setLocalPhotosDir(`${folder}\\Fotos`);
      }
    }
  };


  const pickPhotosDir = async () => {
    const picked = await window.pywebview.api.pick_folder();
    if (picked) setLocalPhotosDir(picked);
  };

  const toggleBlade = (sn) => {
    setSelectedBlades((prev) =>
      prev.includes(sn) ? prev.filter((item) => item !== sn) : [...prev, sn]
    );
  };

  const selectAllBlades = () => {
    setSelectedBlades(blades.map((b) => b.bladeSerialNumber));
  };

  const deselectAllBlades = () => {
    setSelectedBlades([]);
  };

  const handleLogin = async () => {
    if (!incidentUrl.trim()) return;
    setLoggingIn(true);
    setLogs((prev) => [...prev, { text: `Abrindo navegador em: ${incidentUrl}`, type: 'info' }]);
    try {
      const res = await window.pywebview.api.snow_automation_login(incidentUrl.trim());
      if (res.success) {
        setLogs((prev) => [...prev, {
          text: '✓ Navegador aberto — faça login manualmente na janela. A sessão fica salva pras próximas vezes.',
          type: 'success'
        }]);
      } else {
        setLogs((prev) => [...prev, { text: `✗ Falha ao abrir navegador: ${res.error}`, type: 'error' }]);
      }
    } catch (err) {
      setLogs((prev) => [...prev, { text: `Erro crítico: ${err.message || err}`, type: 'error' }]);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleCloseSession = async () => {
    await window.pywebview.api.snow_automation_close();
    setLogs((prev) => [...prev, { text: 'Sessão do navegador encerrada.', type: 'info' }]);
  };

  const handleRun = async () => {
    if (!excelPath || !incidentUrl.trim()) return;

    setRunning(true);
    setRan(false);
    setLogs([]);
    setResult(null);

    const options = {
      headless,
      selectedBlades,
      localPhotosDir,
      autoSubmit,
      includeBlankImages,
      skipSubmitted,
      processOnlyVideos,
      ...(startRow ? { startRow: parseInt(startRow, 10) } : {}),
      ...(endRow ? { endRow: parseInt(endRow, 10) } : {}),
    };






    try {
      const res = await window.pywebview.api.snow_automation_run(excelPath, incidentUrl.trim(), options);
      setResult(res);
      if (res.success) {
        setLogs((prev) => [...prev, {
          text: `✓ Automação concluída: ${res.processed} ok, ${res.failed} falha(s).`,
          type: res.failed > 0 ? 'warning' : 'success'
        }]);
      } else {
        setLogs((prev) => [...prev, { text: `✗ Falha: ${res.error}`, type: 'error' }]);
      }
    } catch (err) {
      setLogs((prev) => [...prev, { text: `Erro crítico: ${err.message || err}`, type: 'error' }]);
    } finally {
      setRunning(false);
      setRan(true);
    }
  };

  const logColor = (type) => {
    if (type === 'success') return D.success;
    if (type === 'error') return D.error;
    if (type === 'warning') return D.warning;
    return D.textSecond;
  };

  const accent = '#0284c7'; // Azul do cliente SNOW/NAWP

  return (
    <div style={{ display: 'flex', gap: '18px', height: '100%', minHeight: 0 }}>
      {/* Painel Esquerdo — Configurações */}
      <div style={{
        flex: '0 0 360px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        overflowY: 'auto',
        paddingRight: '4px'
      }}>
        <div style={{
          background: `${accent}12`,
          border: `1px solid ${accent}40`,
          borderRadius: '8px',
          padding: '10px',
          fontSize: '11px',
          color: D.textSecond,
          lineHeight: '1.5'
        }}>
          Upload de fotos aprimorado: envia automaticamente as 2 fotos do Módulo 23 (pic1 com polígono desenhado + pic2 regional) da pasta local.
        </div>

        {/* Planilha */}
        <div className="form-group">
          <div className="field-label" style={{ color: D.textMuted }}>Planilha SNOW (gerada pelo módulo 23)</div>
          <div className="form-input-row">
            <div
              className={`input-field${excelPath ? " filled" : ""}`}
              onClick={!running ? pickExcel : undefined}
              style={{ cursor: running ? 'not-allowed' : 'pointer' }}
            >
              <span style={{ color: excelPath ? accent : D.textMuted, flexShrink: 0 }}>📁</span>
              <span className="input-field-text" title={excelPath || 'Selecione o arquivo .xlsx'}>
                {excelPath ? excelPath.split('\\').pop() : 'Selecione o arquivo .xlsx'}
              </span>
            </div>
          </div>
        </div>

        {/* Pasta de Fotos Locais do Módulo 23 */}
        <div className="form-group">
          <div className="field-label" style={{ color: D.textMuted }}>Pasta de Fotos Geradas (Módulo 23 - Fotos/)</div>
          <div className="form-input-row">
            <div
              className={`input-field${localPhotosDir ? " filled" : ""}`}
              onClick={!running ? pickPhotosDir : undefined}
              style={{ cursor: running ? 'not-allowed' : 'pointer' }}
            >
              <span style={{ color: localPhotosDir ? accent : D.textMuted, flexShrink: 0 }}>🖼️</span>
              <span className="input-field-text" title={localPhotosDir || 'Selecione a pasta Fotos/ (opcional)'}>
                {localPhotosDir ? localPhotosDir.split('\\').pop() : 'Selecione a pasta Fotos/ (opcional)'}
              </span>
            </div>
          </div>
          <div style={{ fontSize: '10px', color: D.textMuted, marginTop: '4px' }}>
            Se selecionada, envia pic1 (polígono) + pic2 (zoom regional). Se vazia, baixa do link.
          </div>
        </div>


        {/* Pás encontradas */}
        {excelPath && (
          <div style={{
            background: D.bgCard,
            border: `1px solid ${D.borderLight}`,
            borderRadius: '8px',
            padding: '10px',
            fontSize: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600, color: D.textPrimary }}>Pás Encontradas na Planilha:</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={selectAllBlades}
                  disabled={running}
                  style={{ background: 'none', border: 0, color: accent, cursor: 'pointer', fontSize: '10px', padding: 0 }}
                >
                  Todas
                </button>
                <span style={{ color: D.borderLight }}>|</span>
                <button
                  type="button"
                  onClick={deselectAllBlades}
                  disabled={running}
                  style={{ background: 'none', border: 0, color: D.textMuted, cursor: 'pointer', fontSize: '10px', padding: 0 }}
                >
                  Nenhuma
                </button>
              </div>
            </div>

            {loadingBlades ? (
              <div style={{ fontSize: '11px', color: D.textMuted }}>Carregando pás...</div>
            ) : blades.length === 0 ? (
              <div style={{ fontSize: '11px', color: D.textMuted }}>Nenhuma pá válida encontrada.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                {blades.map((b) => {
                  const isChecked = selectedBlades.includes(b.bladeSerialNumber);
                  return (
                    <label
                      key={b.bladeSerialNumber}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: isChecked ? `${accent}10` : 'transparent',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: `1px solid ${isChecked ? accent + '40' : D.borderLight}`,
                        cursor: running ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleBlade(b.bladeSerialNumber)}
                          disabled={running}
                        />
                        <span style={{ fontWeight: 600, color: D.textPrimary, fontSize: '11px' }}>
                          Pá S/N {b.shortSn}
                        </span>

                      </div>
                      <span style={{ color: D.textMuted, fontSize: '10px' }}>
                        {b.count} dano(s) (L{b.startRow}-{b.endRow})
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Incidente */}
        <div className="form-group">
          <div className="field-label" style={{ color: D.textMuted }}>URL do Inspection Report (Incidente)</div>
          <input
            type="text"
            value={incidentUrl}
            onChange={(e) => setIncidentUrl(e.target.value)}
            disabled={running}
            placeholder="https://.../inspection_report.do?sys_id=..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: '8px',
              border: `1px solid ${D.borderLight}`,
              background: D.bgCard,
              color: D.textPrimary,
              fontSize: '12px'
            }}
          />
        </div>

        {/* Login */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleLogin}
            disabled={loggingIn || running || !incidentUrl.trim()}
            style={{
              flex: 1,
              background: D.bgCard,
              border: `1px solid ${D.borderLight}`,
              color: D.textPrimary,
              borderRadius: '8px',
              padding: '8px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: (loggingIn || running || !incidentUrl.trim()) ? 'not-allowed' : 'pointer',
              opacity: (loggingIn || running || !incidentUrl.trim()) ? 0.6 : 1
            }}
          >
            {loggingIn ? 'Abrindo...' : '🔑 Abrir p/ Login'}
          </button>
          <button
            onClick={handleCloseSession}
            disabled={running}
            title="Encerra o navegador (não apaga a sessão salva)"
            style={{
              background: D.bgCard,
              border: `1px solid ${D.borderLight}`,
              color: D.textMuted,
              borderRadius: '8px',
              padding: '8px 10px',
              fontSize: '12px',
              cursor: running ? 'not-allowed' : 'pointer',
              opacity: running ? 0.6 : 1
            }}
          >
            ✕
          </button>
        </div>

        {/* Faixa de linhas (opcional, pra retomar depois de uma falha) */}
        <div className="form-group">
          <div className="field-label" style={{ color: D.textMuted }}>Faixa de linhas filtradas (opcional)</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="number" min="1" placeholder="Início"
              value={startRow} onChange={(e) => setStartRow(e.target.value)}
              disabled={running}
              style={{ width: '50%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${D.borderLight}`, background: D.bgCard, color: D.textPrimary, fontSize: '12px' }}
            />
            <input
              type="number" min="1" placeholder="Fim"
              value={endRow} onChange={(e) => setEndRow(e.target.value)}
              disabled={running}
              style={{ width: '50%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${D.borderLight}`, background: D.bgCard, color: D.textPrimary, fontSize: '12px' }}
            />
          </div>
          <div style={{ fontSize: '10px', color: D.textMuted, marginTop: '4px' }}>
            Vazio = processa todas as linhas das pás selecionadas acima.
          </div>
        </div>

        {/* Headless, Submissão & Blank Image */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: D.textSecond, cursor: 'pointer' }}>
            <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} disabled={running} />
            Rodar em segundo plano (sem mostrar o navegador)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: D.textSecond, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoSubmit} onChange={(e) => setAutoSubmit(e.target.checked)} disabled={running} />
            Submeter formulário automaticamente (desativado = apenas preenche)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: D.textSecond, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeBlankImages} onChange={(e) => setIncludeBlankImages(e.target.checked)} disabled={running} />
            Incluir 5 entradas "Blank Image" (para inspeções com menos de 5 defeitos)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: D.textSecond, cursor: 'pointer' }}>
            <input type="checkbox" checked={skipSubmitted} onChange={(e) => setSkipSubmitted(e.target.checked)} disabled={running} />
            Ignorar defeitos já submetidos no histórico (evita duplicatas ao reiniciar)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: D.textSecond, cursor: 'pointer' }}>
            <input type="checkbox" checked={processOnlyVideos} onChange={(e) => setProcessOnlyVideos(e.target.checked)} disabled={running} />
            Processar APENAS Vídeos (DF 45-50) — ignora os defeitos normais
          </label>
        </div>







        {/* Botão de Run */}
        <button
          onClick={handleRun}
          disabled={running || !excelPath || !incidentUrl.trim() || selectedBlades.length === 0}
          style={{
            background: (running || selectedBlades.length === 0) ? D.bgHover : accent,
            color: '#fff',
            border: 0,
            borderRadius: '8px',
            padding: '10px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: (running || !excelPath || !incidentUrl.trim() || selectedBlades.length === 0) ? 'not-allowed' : 'pointer',
            opacity: (running || !excelPath || !incidentUrl.trim() || selectedBlades.length === 0) ? 0.6 : 1,
            marginTop: 'auto'
          }}
        >
          {running ? 'Rodando...' : `▶ Rodar Automação (${selectedBlades.length} pá(s))`}
        </button>
      </div>


      {/* Painel Direito — Logs e Progresso */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: D.bgCard,
        border: `1px solid ${D.borderLight}`,
        borderRadius: '12px',
        padding: '16px',
        minHeight: 0,
        height: '100%'
      }}>
        {result && (
          <div style={{
            display: 'flex', gap: '16px', marginBottom: '14px', fontSize: '12px',
            padding: '10px 12px', borderRadius: '8px', background: D.bgHover
          }}>
            <span style={{ color: D.success, fontWeight: 600 }}>{result.processed ?? 0} ok</span>
            <span style={{ color: result.failed ? D.error : D.textMuted, fontWeight: 600 }}>{result.failed ?? 0} falha(s)</span>
          </div>
        )}

        <div style={{
          flex: 1,
          background: D.bgBody,
          borderRadius: '8px',
          border: `1px solid ${D.borderLight}`,
          padding: '12px',
          fontFamily: 'monospace',
          fontSize: '11px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}>
          {logs.length === 0 ? (
            <div style={{ color: D.textMuted, textAlign: 'center', marginTop: '40px' }}>
              Aguardando início do processo...
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} style={{ color: logColor(log.type), whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                {log.text}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
