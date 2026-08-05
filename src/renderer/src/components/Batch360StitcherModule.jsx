// components/Batch360StitcherModule.jsx
// Módulo de Costura em Lote 360 — gera projetos .insprj otimizados para o Insta360 Studio

import { useState, useEffect, useRef } from 'react';

const MAX_LOGS = 300;

export default function Batch360StitcherModule({ D, isPyWebView }) {
  const [rootDir, setRootDir] = useState('');
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const logsEndRef = useRef(null);

  // Escuta eventos batch_stitch_log vindos do Main
  useEffect(() => {
    const handler = (e) => {
      const { message, type } = e.detail || {};
      setLogs(prev => {
        const next = [...prev, { text: message, type: type || 'info' }];
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
      });
    };
    window.addEventListener('batch_stitch_log', handler);
    return () => window.removeEventListener('batch_stitch_log', handler);
  }, []);

  // Auto scroll de logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const pickFolder = async () => {
    const picked = await window.pywebview.api.pick_folder();
    if (picked) setRootDir(picked);
  };

  const handleRun = async () => {
    if (!rootDir) return;
    setRunning(true);
    setRan(false);
    setLogs([]);
    setResult(null);

    try {
      const res = await window.pywebview.api.batch_360_stitch(rootDir, 'insprj');
      setResult(res);
    } catch (err) {
      setLogs(prev => [...prev, { text: `Erro: ${err.message || err}`, type: 'error' }]);
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

  const accent = '#7c3aed'; // roxo/violeta para diferenciar do Ferramentas

  return (
    <div style={{ display: 'flex', gap: '18px', height: '100%', minHeight: 0 }}>
      {/* Painel esquerdo — Configuração */}
      <div style={{
        flex: '0 0 340px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        overflowY: 'auto',
        paddingRight: '4px'
      }}>

        {/* Info box */}
        <div style={{
          background: `${accent}12`,
          border: `1px solid ${accent}30`,
          borderRadius: '10px',
          padding: '14px 16px',
          fontSize: '12px',
          color: D.textSecond,
          lineHeight: '1.6'
        }}>
          <div style={{ color: accent, fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
            Como funciona?
          </div>
          O Batch 360 Stitcher escaneia todos os vídeos brutos da câmera Insta360 e gera
          arquivos <strong style={{ color: D.textPrimary }}>.insprj</strong> pré-configurados ao lado de cada vídeo,
          com costura em modo rápido (sem Optical Flow AI). Abra a fila de exportação
          no <strong style={{ color: D.textPrimary }}>Insta360 Studio</strong> para renderizar tudo em lote com H.264 + NVENC.
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ background: `${D.success}18`, color: D.success, borderRadius: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>
              H.264 + NVENC
            </span>
            <span style={{ background: `${D.warning}18`, color: D.warning, borderRadius: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>
              Sem Optical Flow AI
            </span>
            <span style={{ background: `${accent}18`, color: accent, borderRadius: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>
              Geração em lote
            </span>
          </div>
        </div>

        {/* Seleção da pasta raiz */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>
            Pasta de Vídeos 360
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div
              style={{
                flex: 1,
                background: D.inputBg,
                border: `1px solid ${rootDir ? accent + '55' : D.border}`,
                borderRadius: '8px',
                padding: '9px 12px',
                fontSize: '12px',
                color: rootDir ? D.textPrimary : D.textMuted,
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'border-color 0.2s',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              onClick={isPyWebView ? pickFolder : undefined}
              title={rootDir || 'Clique para selecionar a pasta raiz com as gravações 360'}
            >
              {rootDir || 'Clique para selecionar a pasta (ex: D:\\360\\28.07.2026)'}
            </div>
            {rootDir && (
              <button
                onClick={() => setRootDir('')}
                style={{
                  background: `${D.error}15`,
                  border: `1px solid ${D.error}30`,
                  borderRadius: '8px',
                  color: D.error,
                  cursor: 'pointer',
                  padding: '0 10px',
                  fontSize: '13px',
                  fontWeight: 700
                }}
                title="Limpar seleção"
              >
                ✕
              </button>
            )}
          </div>
          {rootDir && (
            <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '4px', paddingLeft: '2px' }}>
              {rootDir}
            </div>
          )}
        </div>

        {/* Resultado */}
        {ran && result && (
          <div style={{
            background: result.success ? `${D.success}12` : `${D.error}12`,
            border: `1px solid ${result.success ? D.success : D.error}30`,
            borderRadius: '10px',
            padding: '12px 16px',
          }}>
            <div style={{ color: result.success ? D.success : D.error, fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
              {result.success ? 'Concluido com sucesso!' : 'Erro na execucao'}
            </div>
            {result.success && (
              <div style={{ fontSize: '12px', color: D.textSecond }}>
                <strong style={{ color: D.textPrimary }}>{result.count}</strong> projetos .insprj gerados.
                Abra o Insta360 Studio e use a fila de exportacao em lote.
              </div>
            )}
            {result.error && (
              <div style={{ fontSize: '12px', color: D.error }}>{result.error}</div>
            )}
          </div>
        )}

        {/* Botão de execução */}
        <button
          onClick={handleRun}
          disabled={running || !rootDir}
          style={{
            background: running || !rootDir ? D.accentSofter : accent,
            color: running || !rootDir ? D.textMuted : '#fff',
            border: 'none',
            borderRadius: '10px',
            padding: '12px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: running || !rootDir ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            letterSpacing: '0.02em'
          }}
        >
          {running ? 'Gerando projetos...' : 'Gerar Projetos .insprj em Lote'}
        </button>

        {/* Barra de progresso indeterminada */}
        {running && (
          <div style={{
            height: '3px',
            background: D.accentSofter,
            borderRadius: '2px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: '40%',
              background: accent,
              borderRadius: '2px',
              animation: 'indeterminate 1.4s ease infinite'
            }} />
          </div>
        )}
      </div>

      {/* Painel direito — Log */}
      <div style={{
        flex: 1,
        background: D.logBg,
        borderRadius: '10px',
        border: `1px solid ${D.border}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${D.border}`,
          fontSize: '11px',
          fontWeight: 700,
          color: D.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>Log de Execucao</span>
          {logs.length > 0 && (
            <button
              onClick={() => setLogs([])}
              style={{
                background: 'none',
                border: 'none',
                color: D.textMuted,
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px'
              }}
            >
              Limpar
            </button>
          )}
        </div>
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 14px',
          fontFamily: 'monospace',
          fontSize: '11.5px',
          lineHeight: '1.7'
        }}>
          {logs.length === 0 && !running && (
            <div style={{ color: D.textMuted, fontStyle: 'italic' }}>
              Selecione a pasta e clique em "Gerar Projetos" para iniciar...
            </div>
          )}
          {logs.map((log, i) => (
            <div key={i} style={{ color: logColor(log.type), marginBottom: '1px' }}>
              {log.text}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
