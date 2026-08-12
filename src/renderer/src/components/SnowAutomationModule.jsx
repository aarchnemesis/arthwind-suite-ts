// components/SnowAutomationModule.jsx
// Automação do "Create Damage Report Entry" na plataforma SNOW — lê a planilha já
// gerada pelo SNOW Processor (módulo 23) e preenche o formulário via navegador
// controlado (Playwright). Sessão de login fica salva num perfil persistente, não
// precisa logar de novo a cada execução (só quando a sessão expirar de verdade).

import { useState, useEffect, useRef } from 'react';

const MAX_LOGS = 800;

export default function SnowAutomationModule({ D }) {
  const [excelPath, setExcelPath] = useState('');
  const [incidentUrl, setIncidentUrl] = useState('');
  const [headless, setHeadless] = useState(false);
  const [startRow, setStartRow] = useState('');
  const [endRow, setEndRow] = useState('');
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

  const pickExcel = async () => {
    const picked = await window.pywebview.api.pick_file('xlsx');
    if (picked) setExcelPath(picked);
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
        flex: '0 0 340px',
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
          Os campos do formulário do SNOW são um widget de busca (não é dropdown nativo) —
          selectors ajustados por texto visível (label/opção). Se algum campo não bater,
          veja <code>docs/snow-automation.md</code>.
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
          <div className="field-label" style={{ color: D.textMuted }}>Faixa de linhas (opcional)</div>
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
            Vazio = processa a planilha inteira. Útil pra retomar de onde uma linha falhou.
          </div>
        </div>

        {/* Headless */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: D.textSecond, cursor: 'pointer' }}>
          <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} disabled={running} />
          Rodar em segundo plano (sem mostrar o navegador)
        </label>

        {/* Botão de Run */}
        <button
          onClick={handleRun}
          disabled={running || !excelPath || !incidentUrl.trim()}
          style={{
            background: running ? D.bgHover : accent,
            color: '#fff',
            border: 0,
            borderRadius: '8px',
            padding: '10px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: (running || !excelPath || !incidentUrl.trim()) ? 'not-allowed' : 'pointer',
            opacity: (running || !excelPath || !incidentUrl.trim()) ? 0.6 : 1,
            marginTop: 'auto'
          }}
        >
          {running ? 'Rodando...' : '▶ Rodar Automação'}
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
