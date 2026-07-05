import { useState, useEffect, useCallback } from 'react';

// Módulo 19 — Arthnex Uploader: replica corrigida do "Image Uploader" oficial
// (mesma API: scheduler.arthnex.com + x-api-key estática). A correção em relação ao
// original é no backend (arthnex_uploader_api.py): o nome enviado ao servidor é sempre
// só o nome do arquivo (sem subpastas), mesmo quando o CSV referencia o arquivo por um
// caminho relativo com subpastas (caso comum do Arthdrone).
export default function ArthnexUploaderModule({ T, D }) {
  const [useHomolog, setUseHomolog] = useState(false);
  const [workorders, setWorkorders] = useState([]);
  const [blades, setBlades] = useState([]);
  const [workorderId, setWorkorderId] = useState('');
  const [workorderQuery, setWorkorderQuery] = useState('');
  const [windbladeId, setWindbladeId] = useState('');
  const [bladeQuery, setBladeQuery] = useState('');
  const [pSurface, setPSurface] = useState('');
  const [turbineId, setTurbineId] = useState('');
  const [collectDate, setCollectDate] = useState('');
  const [csvPath, setCsvPath] = useState('');
  const [loadingWo, setLoadingWo] = useState(false);
  const [loadingBlades, setLoadingBlades] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(prev => [...prev, { text, type }]);
  }, []);

  useEffect(() => {
    if (typeof window.pywebview === 'undefined') return;
    const onLog = (e) => addLog(e.detail.text, e.detail.type);
    const onProgress = (e) => setProgress(Math.round((e.detail.current / e.detail.total) * 100));
    const onDone = (e) => { setRunning(false); setResult(e.detail); };
    window.addEventListener('arthlog', onLog);
    window.addEventListener('arthprogress', onProgress);
    window.addEventListener('arthnex_upload_done', onDone);
    return () => {
      window.removeEventListener('arthlog', onLog);
      window.removeEventListener('arthprogress', onProgress);
      window.removeEventListener('arthnex_upload_done', onDone);
    };
  }, [addLog]);

  const carregarWorkorders = useCallback(async () => {
    if (typeof window.pywebview === 'undefined') return;
    setLoadingWo(true);
    setWorkorders([]); setWorkorderId(''); setWorkorderQuery(''); setBlades([]); setWindbladeId(''); setBladeQuery('');
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

  const onChangeWorkorder = useCallback(async (id) => {
    setWorkorderId(id);
    setBlades([]); setWindbladeId(''); setBladeQuery('');
    const wo = workorders.find(w => String(w.id) === String(id));
    setPSurface(wo?.p_surface || '');
    if (!id) return;
    setLoadingBlades(true);
    try {
      const res = await window.pywebview.api.arthnex_listar_pas(id, useHomolog);
      if (res.success) {
        const sorted = [...res.data].sort((a, b) => `${a.blade} ${a.turbine}`.localeCompare(`${b.blade} ${b.turbine}`));
        setBlades(sorted);
      } else addLog(`Erro ao carregar pás: ${res.error}`, 'error');
    } finally {
      setLoadingBlades(false);
    }
  }, [workorders, useHomolog, addLog]);

  const onChangeBlade = useCallback((id) => {
    setWindbladeId(id);
    const blade = blades.find(b => String(b.id) === String(id));
    setTurbineId(blade?.turbine_id || '');
  }, [blades]);

  // Combobox digitável: o usuário digita pra filtrar (via <datalist>) e, quando o
  // texto bate exatamente com uma das opções, seleciona — sem isso, com centenas de
  // workorders fora de ordem alfabética, achar uma na lista era inviável.
  const onTypeWorkorder = useCallback((text) => {
    setWorkorderQuery(text);
    const match = workorders.find(w => w.description === text);
    if (match) onChangeWorkorder(match.id);
    else if (!text) onChangeWorkorder('');
  }, [workorders, onChangeWorkorder]);

  const onTypeBlade = useCallback((text) => {
    setBladeQuery(text);
    const match = blades.find(b => `${b.blade} - ${b.turbine}` === text);
    if (match) onChangeBlade(match.id);
    else if (!text) onChangeBlade('');
  }, [blades, onChangeBlade]);

  const pickCsv = async () => {
    const path = await window.pywebview.api.pick_file('csv');
    if (path) setCsvPath(path);
  };

  const canRun = workorderId && windbladeId && collectDate && csvPath && !running;

  const onUpload = async () => {
    setRunning(true); setProgress(0); setLogs([]); setResult(null);
    await window.pywebview.api.arthnex_upload(
      csvPath, workorderId, windbladeId, pSurface, collectDate, turbineId, useHomolog,
    );
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
          <label style={labelStyle}>Blade SN {windbladeId && !loadingBlades ? '✓' : ''}</label>
          <input
            style={fieldStyle} list="arthnex-blade-options"
            value={bladeQuery} disabled={!workorderId || loadingBlades || running}
            placeholder={loadingBlades ? 'Carregando...' : 'Digite para buscar...'}
            onChange={(e) => onTypeBlade(e.target.value)}
          />
          <datalist id="arthnex-blade-options">
            {blades.map(b => <option key={b.id} value={`${b.blade} - ${b.turbine}`} />)}
          </datalist>
        </div>
      </div>

      <div>
        <label style={labelStyle}>Data de coleta</label>
        <input type="date" style={{ ...fieldStyle, maxWidth: '220px' }} value={collectDate} disabled={running}
          onChange={(e) => setCollectDate(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>CSV de upload (as fotos devem estar na mesma pasta do CSV, em subpastas conforme a coluna image_id)</label>
          <input style={fieldStyle} value={csvPath} readOnly placeholder="Nenhum arquivo selecionado" />
        </div>
        <button onClick={pickCsv} disabled={running} style={{ padding: '7px 12px', borderRadius: '5px', border: `1px solid ${D.border}`, background: D.bgCard, color: D.textPrimary, cursor: 'pointer', fontSize: '12px' }}>Selecionar</button>
      </div>

      <button onClick={onUpload} disabled={!canRun} style={{
        padding: '10px', borderRadius: '6px', border: 'none', cursor: canRun ? 'pointer' : 'not-allowed',
        background: canRun ? D.accent : D.border, color: '#fff', fontSize: '13px', fontWeight: 600, opacity: canRun ? 1 : 0.6,
      }}>
        {running ? `Enviando... ${progress}%` : 'Subir fotos'}
      </button>

      {running && (
        <div style={{ height: '6px', borderRadius: '3px', background: D.bgCard, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: D.accent, transition: 'width 0.2s' }} />
        </div>
      )}

      {result && (
        <div style={{
          padding: '10px 12px', borderRadius: '6px', fontSize: '12px',
          background: result.success ? `${D.success}14` : `${D.error}14`,
          color: result.success ? D.success : D.error,
          border: `1px solid ${result.success ? D.success : D.error}33`,
        }}>
          {result.success
            ? `Concluído: ${result.enviados}/${result.total} fotos enviadas.${result.falhas?.length ? ` ${result.falhas.length} falha(s) — ver log.` : ''}`
            : `Erro: ${result.error}`}
        </div>
      )}

      <div style={{
        fontFamily: 'monospace', fontSize: '11px', background: D.logBg, border: `1px solid ${D.border}`,
        borderRadius: '6px', padding: '8px 10px', maxHeight: '220px', overflowY: 'auto', color: D.textSecond,
      }}>
        {logs.length === 0
          ? <span style={{ fontStyle: 'italic', color: D.textMuted }}>O log do envio aparecerá aqui.</span>
          : logs.map((l, i) => (
            <div key={i} style={{ color: l.type === 'error' ? D.error : l.type === 'warn' ? D.warning : D.textSecond }}>{l.text}</div>
          ))}
      </div>
    </div>
  );
}
