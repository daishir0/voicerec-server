'use client';

import { useState, useEffect, useCallback } from 'react';

const AUTH = 'Basic ' + btoa('test1:test1pass');
const CONDITIONS = ['B1', 'B2', 'B3', 'proposed', 'A1', 'A2', 'A3', 'A4', 'A5'];

interface Domain {
  id: string;
  name: string;
}

interface EvalResult {
  id: string;
  recordingId: string;
  recordingName: string;
  domainId: string;
  domainName: string;
  condition: string;
  annotatorId: string;
  cerDE: number;
  cerGEN: number;
  cerTotal: number;
  dkdpRatio: number;
  entityCount: number;
  createdAt: string;
}

interface Recording {
  id: string;
  displayName: string;
  originalName: string;
  transcriptionStatus: string;
}

// 録音×条件のマトリクス行
interface MatrixRow {
  recordingId: string;
  recordingName: string;
  results: Partial<Record<string, EvalResult>>;
}

export default function EvaluationPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [message, setMessage] = useState('');

  // GT作成フォーム
  const [showGTForm, setShowGTForm] = useState(false);
  const [gtRecordingId, setGtRecordingId] = useState('');
  const [gtAnnotatorId, setGtAnnotatorId] = useState('annotator1');
  const [gtSegments, setGtSegments] = useState('');

  // CER計算フォーム
  const [calcRecordingId, setCalcRecordingId] = useState('');
  const [calcConditions, setCalcConditions] = useState<string[]>(['B1', 'B3', 'proposed']);
  const [calcAnnotatorId, setCalcAnnotatorId] = useState('annotator1');

  useEffect(() => {
    fetchDomains();
    fetchRecordings();
  }, []);

  const fetchDomains = async () => {
    const res = await fetch('/api/ontology/domains', { headers: { Authorization: AUTH } });
    if (res.ok) setDomains(await res.json());
  };

  const fetchRecordings = async () => {
    const res = await fetch('/api/recordings', { headers: { Authorization: AUTH } });
    if (res.ok) setRecordings(await res.json());
  };

  const fetchResults = useCallback(async () => {
    if (!selectedDomainId) return;
    setLoading(true);
    const url = `/api/evaluation/results?domainId=${selectedDomainId}`;
    const res = await fetch(url, { headers: { Authorization: AUTH } });
    if (res.ok) setResults(await res.json());
    setLoading(false);
  }, [selectedDomainId]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const handleCalculate = async () => {
    if (!calcRecordingId || !selectedDomainId || calcConditions.length === 0) {
      setMessage('録音、ドメイン、条件を選択してください');
      return;
    }
    setCalcLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/evaluation/calculate', {
        method: 'POST',
        headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordingId: calcRecordingId,
          domainId: selectedDomainId,
          conditions: calcConditions,
          annotatorId: calcAnnotatorId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const condSummary = Object.entries(data.results as Record<string, { cerDE: number }>)
          .map(([c, r]) => `${c}: cerDE=${r.cerDE.toFixed(3)}`)
          .join(', ');
        const errSummary = data.errors
          ? ' エラー: ' + Object.entries(data.errors as Record<string, string>).map(([c, e]) => `${c}=${e}`).join(', ')
          : '';
        setMessage(`計算完了: ${condSummary}${errSummary}`);
        fetchResults();
      } else {
        setMessage(`エラー: ${data.error ?? res.statusText}`);
      }
    } catch (e) {
      setMessage(`通信エラー: ${(e as Error).message}`);
    }
    setCalcLoading(false);
  };

  const handleSaveGT = async () => {
    if (!gtRecordingId || !selectedDomainId || !gtSegments.trim()) {
      setMessage('録音・ドメイン・セグメントを入力してください');
      return;
    }
    let segs;
    try {
      segs = JSON.parse(gtSegments);
    } catch {
      setMessage('セグメントのJSON形式が不正です');
      return;
    }
    const res = await fetch(`/api/recordings/${gtRecordingId}/ground-truth`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainId: selectedDomainId, annotatorId: gtAnnotatorId, segments: segs }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage(`GT保存完了: id=${data.id}`);
      setShowGTForm(false);
      setGtSegments('');
    } else {
      setMessage(`GTエラー: ${data.error}`);
    }
  };

  const toggleCondition = (cond: string) => {
    setCalcConditions((prev) =>
      prev.includes(cond) ? prev.filter((c) => c !== cond) : [...prev, cond]
    );
  };

  // 結果をマトリクス形式に変換
  const conditionsInResults = Array.from(new Set(results.map((r) => r.condition))).sort();
  const rowMap = new Map<string, MatrixRow>();
  for (const r of results) {
    if (!rowMap.has(r.recordingId)) {
      rowMap.set(r.recordingId, {
        recordingId: r.recordingId,
        recordingName: r.recordingName,
        results: {},
      });
    }
    rowMap.get(r.recordingId)!.results[r.condition] = r;
  }
  const matrixRows = Array.from(rowMap.values());

  const fmt = (v: number | undefined) => (v !== undefined ? v.toFixed(3) : '-');
  const fmtRatio = (v: number | undefined) => (v !== undefined ? v.toFixed(2) : '-');

  // B3とproposedの差分
  const diff = (b3: number | undefined, prop: number | undefined) => {
    if (b3 === undefined || prop === undefined) return '-';
    const d = b3 - prop;
    const pct = b3 > 0 ? ((d / b3) * 100).toFixed(0) : '0';
    return `${d.toFixed(3)} (${pct}%${d >= 0 ? '↓' : '↑'})`;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '8px' }}>評価ダッシュボード</h1>
      <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>
        CER-DE / CER-GEN / dkdpRatio を条件別に比較
      </p>

      {/* ドメイン選択 */}
      <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ fontWeight: 600 }}>ドメイン:</label>
        <select
          value={selectedDomainId}
          onChange={(e) => setSelectedDomainId(e.target.value)}
          style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #ddd' }}
        >
          <option value="">-- 選択 --</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {selectedDomainId && (
          <button
            onClick={fetchResults}
            style={{
              padding: '6px 12px', backgroundColor: '#6c757d', color: '#fff',
              border: 'none', borderRadius: '4px', cursor: 'pointer'
            }}
          >
            更新
          </button>
        )}
      </div>

      {message && (
        <div style={{
          padding: '10px 16px', marginBottom: '16px', borderRadius: '4px',
          backgroundColor: message.includes('エラー') ? '#fff3f3' : '#f0fff4',
          border: `1px solid ${message.includes('エラー') ? '#f5c6cb' : '#c3e6cb'}`,
          fontSize: '13px', whiteSpace: 'pre-wrap'
        }}>
          {message}
        </div>
      )}

      {/* GT作成フォーム */}
      <div style={{ marginBottom: '24px', border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Ground Truth 登録</h3>
          <button
            onClick={() => setShowGTForm(!showGTForm)}
            style={{
              padding: '6px 12px', backgroundColor: '#17a2b8', color: '#fff',
              border: 'none', borderRadius: '4px', cursor: 'pointer'
            }}
          >
            {showGTForm ? '閉じる' : 'GTを追加'}
          </button>
        </div>
        {showGTForm && (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>録音</label>
                <select
                  value={gtRecordingId}
                  onChange={(e) => setGtRecordingId(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ddd', minWidth: '200px' }}
                >
                  <option value="">-- 選択 --</option>
                  {recordings
                    .filter((r) => r.transcriptionStatus === 'completed')
                    .map((r) => (
                      <option key={r.id} value={r.id}>{r.displayName || r.originalName}</option>
                    ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>アノテーターID</label>
                <input
                  value={gtAnnotatorId}
                  onChange={(e) => setGtAnnotatorId(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ddd', width: '140px' }}
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                segments (JSON配列)
              </label>
              <textarea
                value={gtSegments}
                onChange={(e) => setGtSegments(e.target.value)}
                rows={6}
                placeholder={`[
  {
    "segmentIndex": 0,
    "text": "SLAの確認",
    "domainEntities": [{"text": "SLA", "startPos": 0, "endPos": 3}]
  }
]`}
                style={{
                  width: '100%', padding: '8px', borderRadius: '4px',
                  border: '1px solid #ddd', fontFamily: 'monospace', fontSize: '13px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <button
              onClick={handleSaveGT}
              style={{
                alignSelf: 'flex-start', padding: '8px 20px', backgroundColor: '#28a745',
                color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer'
              }}
            >
              保存
            </button>
          </div>
        )}
      </div>

      {/* CER計算フォーム */}
      {selectedDomainId && (
        <div style={{ marginBottom: '24px', border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px' }}>CER計算</h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>録音</label>
              <select
                value={calcRecordingId}
                onChange={(e) => setCalcRecordingId(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ddd', minWidth: '200px' }}
              >
                <option value="">-- 選択 --</option>
                {recordings
                  .filter((r) => r.transcriptionStatus === 'completed')
                  .map((r) => (
                    <option key={r.id} value={r.id}>{r.displayName || r.originalName}</option>
                  ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>アノテーターID</label>
              <input
                value={calcAnnotatorId}
                onChange={(e) => setCalcAnnotatorId(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ddd', width: '140px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>条件</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {CONDITIONS.map((c) => (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={calcConditions.includes(c)}
                      onChange={() => toggleCondition(c)}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={handleCalculate}
              disabled={calcLoading}
              style={{
                padding: '8px 20px', backgroundColor: '#007bff', color: '#fff',
                border: 'none', borderRadius: '4px', cursor: calcLoading ? 'not-allowed' : 'pointer',
                opacity: calcLoading ? 0.7 : 1
              }}
            >
              {calcLoading ? '計算中...' : 'CER計算'}
            </button>
          </div>
        </div>
      )}

      {/* 結果テーブル */}
      {selectedDomainId && (
        <div>
          <h3 style={{ marginBottom: '12px' }}>
            条件別CER比較
            {loading && <span style={{ fontSize: '13px', color: '#666', fontWeight: 400, marginLeft: '8px' }}>読込中...</span>}
          </h3>
          {matrixRows.length === 0 ? (
            <p style={{ color: '#666', fontSize: '14px' }}>
              まだ評価結果がありません。GTを登録して実験を実行し、CER計算ボタンで結果を生成してください。
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={thStyle}>録音</th>
                    {conditionsInResults.map((c) => (
                      <th key={c} style={thStyle} colSpan={3}>{c}</th>
                    ))}
                    {conditionsInResults.includes('B3') && conditionsInResults.includes('proposed') && (
                      <th style={thStyle}>B3→proposed 改善</th>
                    )}
                  </tr>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={thStyle}></th>
                    {conditionsInResults.map((c) => (
                      <>
                        <th key={`${c}-de`} style={{ ...thStyle, fontSize: '11px', color: '#dc3545' }}>CER-DE</th>
                        <th key={`${c}-gen`} style={{ ...thStyle, fontSize: '11px', color: '#28a745' }}>CER-GEN</th>
                        <th key={`${c}-ratio`} style={{ ...thStyle, fontSize: '11px', color: '#6c757d' }}>ratio</th>
                      </>
                    ))}
                    {conditionsInResults.includes('B3') && conditionsInResults.includes('proposed') && (
                      <th style={{ ...thStyle, fontSize: '11px' }}>CER-DE差</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((row, idx) => (
                    <tr key={row.recordingId} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                      <td style={{ ...tdStyle, fontWeight: 500, maxWidth: '200px', wordBreak: 'break-word' }}>
                        {row.recordingName}
                      </td>
                      {conditionsInResults.map((c) => {
                        const r = row.results[c];
                        return (
                          <>
                            <td key={`${c}-de`} style={{ ...tdStyle, color: '#dc3545', fontWeight: 600 }}>
                              {fmt(r?.cerDE)}
                            </td>
                            <td key={`${c}-gen`} style={{ ...tdStyle, color: '#28a745' }}>
                              {fmt(r?.cerGEN)}
                            </td>
                            <td key={`${c}-ratio`} style={{ ...tdStyle, color: '#6c757d' }}>
                              {fmtRatio(r?.dkdpRatio)}
                            </td>
                          </>
                        );
                      })}
                      {conditionsInResults.includes('B3') && conditionsInResults.includes('proposed') && (
                        <td style={{ ...tdStyle, fontWeight: 600, color: '#007bff' }}>
                          {diff(row.results['B3']?.cerDE, row.results['proposed']?.cerDE)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 全体サマリー */}
          {matrixRows.length > 0 && (
            <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 12px' }}>平均サマリー</h4>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                {conditionsInResults.map((c) => {
                  const condResults = results.filter((r) => r.condition === c);
                  if (condResults.length === 0) return null;
                  const avgDE = condResults.reduce((s, r) => s + r.cerDE, 0) / condResults.length;
                  const avgGEN = condResults.reduce((s, r) => s + r.cerGEN, 0) / condResults.length;
                  const avgRatio = condResults.reduce((s, r) => s + r.dkdpRatio, 0) / condResults.length;
                  return (
                    <div key={c} style={{
                      padding: '12px 16px', backgroundColor: '#fff', borderRadius: '6px',
                      border: '1px solid #dee2e6', minWidth: '140px'
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: '8px' }}>{c}</div>
                      <div style={{ fontSize: '12px', color: '#dc3545' }}>CER-DE: {avgDE.toFixed(3)}</div>
                      <div style={{ fontSize: '12px', color: '#28a745' }}>CER-GEN: {avgGEN.toFixed(3)}</div>
                      <div style={{ fontSize: '12px', color: '#6c757d' }}>ratio: {avgRatio.toFixed(2)}</div>
                      <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>n={condResults.length}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'center',
  border: '1px solid #dee2e6',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'center',
  border: '1px solid #dee2e6',
};
