import { useState, useEffect, useCallback } from 'react';

// Módulo 19 — Arthnex Uploader: replica corrigida do "Image Uploader" oficial
// (mesma API: scheduler.arthnex.com + x-api-key estática). A correção em relação ao
// original é no backend (arthnex_uploader_api.py): o nome enviado ao servidor é sempre
// só o nome do arquivo (sem subpastas), mesmo quando o CSV referencia o arquivo por um
// caminho relativo com subpastas (caso comum do Arthdrone).
//
// Suporta enviar vários CSVs de uma vez (ex: a turbina inteira): a pá de cada CSV é
// detectada automaticamente pela coluna "blade" da primeira linha, casada contra as
// pás pendentes da workorder selecionada — não é preciso escolher a pá manualmente.
export default function ArthnexUploaderModule({ T, D }) {
  const [useHomolog, setUseHomolog] = useState(false);
  const [workorders, setWorkorders] = useState([]);
  const [workorderId, setWorkorderId] = useState('');
  const [workorderQuery, setWorkorderQuery] = useState('');
  const [pSurface, setPSurface] = useState('');
  const [collectDate, setCollectDate] = useState('');
  const [csvPaths, setCsvPaths] = useState([]);
  const [loadingWo, setLoadingWo] = useState(false);
  const [running, setRunning] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const [batchProgress, setBatchProgress] = useState(null);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(prev => [...prev, { text, type }]);
  }, []);

  useEffect(() => {
    if (typeof window.pywebview === 'undefined') return;
    const onLog = (e) => addLog(e.detail.text, e.detail.type);
    const onProgress = (e) => setFileProgress(Math.round((e.detail.current / e.detail.total) * 100));
    const onBatchProgress = (e) => { setBatchProgress(e.detail); setFileProgress(0); };
    window.addEventListener('arthlog', onLog);
    window.addEventListener('arthprogress', onProgress);
    window.addEventListener('arthnex_batch_progress', onBatchProgress);
    return () => {
      window.removeEventListener('arthlog', onLog);
      window.removeEventListener('arthprogress', onProgress);
      window.removeEventListener('arthnex_batch_progress', onBatchProgress);
    };
  }, [addLog]);

  const carregarWorkorders = useCallback(async () => {
    if (typeof window.pywebview === 'undefined') return;
    setLoadingWo(true);
    setWorkorders([]); setWorkorderId(''); setWorkorderQuery('');
    try {
      const res = await window.pywebview.api.arthnex_listar_workorders(useHomolog);
      if (res.success) {
        const sorted = [...res.data].sort((a, b) => a.description.localeCompare(b.description));
        setWorkorders(sorted);
      } else addLog(`Erro ao carregar workorders: ${res.error}`, 'error');
    } finally {
      setLoadingWo(false);
    }
  }, [useHomolog, addLog]);

  useEffect(() => { carregarWorkorders(); }, [carregarWorkorders]);

  const onChangeWorkorder = useCallback((id) => {
    setWorkorderId(id);
    const wo = workorders.find(w => String(w.id) === String(id));
    setPSurface(wo?.p_surface || '');
  }, [workorders]);

  // Combobox digitável: o usuário digita pra filtrar (via <datalist>) e, quando o
  // texto bate exatamente com uma das opções, seleciona — sem isso, com centenas de
  // workorders fora de ordem alfabética, achar uma na lista era inviável.
  const onTypeWorkorder = useCallback((text) => {
    setWorkorderQuery(text);
    const match = workorders.find(w => w.description === text);
    if (match) onChangeWorkorder(match.id);
    else if (!text) onChangeWorkorder('');
  }, [workorders, onChangeWorkorder]);

  const pickCsvs = async () => {
    const paths = await window.pywebview.api.pick_files('csv');
    if (paths && paths.length > 0) {
      setCsvPaths(prev => [...new Set([...prev, ...paths])]);
    }
  };

  const removeCsv = (path) => {
    setCsvPaths(prev => prev.filter(p => p !== path));
  };

  const canRun = workorderId && collectDate && csvPaths.length > 0 && !running;

  const onUpload = async () => {
    setRunning(true); setFileProgress(0); setBatchProgress(null); setLogs([]); setResult(null);
    const res = await window.pywebview.api.arthnex_upload_multi(
      csvPaths, workorderId, pSurface, collectDate, useHomolog,
    );
    setRunning(false);
    setResult(res);
  };

  const fieldStyle = {
    width: '100%', padding: '7px 9px', borderRadius: '5px',
    border: `1px solid ${D.border}`, background: D.inputBg, color: D.textPrimary, fontSize: '12.5px',
  };
  const labelStyle = { fontSize: '11px', color: D.textSecond, marginBottom: '4px', display: 'block' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '18px', maxWidth: '720px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ fontSize: '12px', color: D.textSecond, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={useHomolog} onChange={(e) => setUseHomolog(e.target.checked)} disabled={running} />
          Usar ambiente de homologação (scheduler-homolog)
        </label>
      </div>

      <div>
        <label style={labelStyle}>Workorder {workorderId && !loadingWo ? '✓' : ''}</label>
        <input
          style={fieldStyle} list="arthnex-wo-options"
          value={workorderQuery} disabled={loadingWo || running}
          placeholder={loadingWo ? 'Carregando...' : 'Digite para buscar...'}
          onChange={(e) => onTypeWorkorder(e.target.value)}
        />
        <datalist id="arthnex-wo-options">
          {workorders.map(wo => <option key={wo.id} value={wo.description} />)}
        </datalist>
      </div>

      <div>
        <label style={labelStyle}>Data de coleta (aplicada a todos os CSVs do lote)</label>
        <input type="date" style={{ ...fieldStyle, maxWidth: '220px' }} value={collectDate} disabled={running}
          onChange={(e) => setCollectDate(e.target.value)} />
      </div>

      <div>
        <label style={labelStyle}>
          CSVs de upload — um por pá (as fotos devem estar na mesma pasta de cada CSV). A pá de cada
          arquivo é detectada automaticamente pela coluna "blade" e casada com as pás pendentes da workorder.
        </label>
        <button onClick={pickCsvs} disabled={running || !workorderId} style={{
          padding: '7px 12px', borderRadius: '5px', border: `1px solid ${D.border}`,
          background: D.bgCard, color: D.textPrimary, cursor: (running || !workorderId) ? 'not-allowed' : 'pointer', fontSize: '12px',
        }}>
          Selecionar CSV(s)
        </button>
        {csvPaths.length > 0 && (
          <div style={{
            marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px',
            border: `1px solid ${D.border}`, borderRadius: '6px', padding: '6px 8px', maxHeight: '160px', overflowY: 'auto',
          }}>
            {csvPaths.map(p => (
              <div key={p} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', color: D.textSecond }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
                <button onClick={() => removeCsv(p)} disabled={running} style={{
                  border: 'none', background: 'none', color: D.error, cursor: running ? 'not-allowed' : 'pointer', fontSize: '13px', padding: '0 4px',
                }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={onUpload} disabled={!canRun} style={{
        padding: '10px', borderRadius: '6px', border: 'none', cursor: canRun ? 'pointer' : 'not-allowed',
        background: canRun ? D.accent : D.border, color: '#fff', fontSize: '13px', fontWeight: 600, opacity: canRun ? 1 : 0.6,
      }}>
        {running
          ? (batchProgress
            ? `Enviando arquivo ${batchProgress.fileIndex}/${batchProgress.fileTotal} (${batchProgress.fileName}) — ${fileProgress}%`
            : 'Iniciando...')
          : `Subir fotos${csvPaths.length > 1 ? ` (${csvPaths.length} arquivos)` : ''}`}
      </button>

      {running && (
        <div style={{ height: '6px', borderRadius: '3px', background: D.bgCard, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${fileProgress}%`, background: D.accent, transition: 'width 0.2s' }} />
        </div>
      )}

      {result && (
        <div style={{
          padding: '10px 12px', borderRadius: '6px', fontSize: '12px',
          background: result.success ? `${D.success}14` : `${D.error}14`,
          color: result.success ? D.success : D.error,
          border: `1px solid ${result.success ? D.success : D.error}33`,
        }}>
          {result.success ? (
            <>
              <div>Lote concluído: {result.totalEnviados}/{result.totalFotos} fotos enviadas em {result.resultados.length} arquivo(s), {result.arquivosComFalha} com falha.</div>
              {result.resultados.map((r, i) => (
                <div key={i} style={{ marginTop: '4px', color: r.success ? D.textSecond : D.error }}>
                  {r.arquivo}: {r.success ? `${r.enviados}/${r.total} enviadas${r.blade ? ` (${r.blade})` : ''}` : `falhou — ${r.error}`}
                </div>
              ))}
            </>
          ) : `Erro: ${result.error}`}
        </div>
      )}

      <div style={{
        fontFamily: 'monospace', fontSize: '11px', background: D.logBg, border: `1px solid ${D.border}`,
        borderRadius: '6px', padding: '8px 10px', maxHeight: '220px', overflowY: 'auto', color: D.textSecond,
      }}>
        {logs.length === 0
          ? <span style={{ fontStyle: 'italic', color: D.textMuted }}>O log do envio aparecerá aqui.</span>
          : logs.map((l, i) => (
            <div key={i} style={{ color: l.type === 'error' ? D.error : l.type === 'warn' || l.type === 'warning' ? D.warning : D.textSecond }}>{l.text}</div>
          ))}
      </div>
    </div>
  );
}
