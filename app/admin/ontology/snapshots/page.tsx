'use client';

import { useState, useEffect } from 'react';

interface Domain {
  id: string;
  name: string;
  description: string;
}

interface Snapshot {
  id: string;
  domainId: string;
  weekNumber: number;
  label: string | null;
  entityCount: number;
  relationCount: number;
  createdAt: string;
  data: string;
}

export default function SnapshotsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [weekNumber, setWeekNumber] = useState('');
  const [label, setLabel] = useState('');
  const [previewSnapshot, setPreviewSnapshot] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState('');

  const auth = 'Basic ' + btoa('test1:test1pass');

  useEffect(() => {
    fetch('/api/ontology/domains', { headers: { Authorization: auth } })
      .then((r) => r.json())
      .then((data) => {
        setDomains(data);
        if (data.length > 0) setSelectedDomain(data[0]);
      });
  }, []);

  useEffect(() => {
    if (selectedDomain) {
      fetch(`/api/ontology/domains/${selectedDomain.id}/snapshots`, { headers: { Authorization: auth } })
        .then((r) => r.json())
        .then(setSnapshots);
    }
  }, [selectedDomain]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDomain) return;
    const res = await fetch(`/api/ontology/domains/${selectedDomain.id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ weekNumber: parseInt(weekNumber), label: label || undefined }),
    });
    if (res.ok) {
      setMessage('スナップショットを作成しました');
      setWeekNumber('');
      setLabel('');
      const updated = await fetch(`/api/ontology/domains/${selectedDomain.id}/snapshots`, { headers: { Authorization: auth } });
      setSnapshots(await updated.json());
    } else {
      const err = await res.json();
      setMessage('エラー: ' + (err.error || 'unknown'));
    }
  };

  return (
    <div className="admin-page">
      <h1>スナップショット管理</h1>

      <div style={{ marginBottom: 16 }}>
        <label>ドメイン選択: </label>
        <select value={selectedDomain?.id || ''} onChange={(e) => {
          const d = domains.find((x) => x.id === e.target.value);
          setSelectedDomain(d || null);
          setPreviewSnapshot(null);
        }}>
          {domains.map((d) => <option key={d.id} value={d.id}>ドメイン{d.name}</option>)}
        </select>
      </div>

      {message && <div className="message-box">{message}</div>}

      <form onSubmit={handleCreate} className="inline-form" style={{ marginBottom: 24 }}>
        <h3>現在の状態をスナップショット</h3>
        <div className="form-row">
          <div className="form-group">
            <label>週番号 *</label>
            <input type="number" min="0" value={weekNumber} onChange={(e) => setWeekNumber(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>ラベル（任意）</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="week1, initial..." />
          </div>
        </div>
        <button type="submit" className="btn-primary">スナップショット作成</button>
      </form>

      <h2>スナップショット一覧</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>週番号</th>
            <th>ラベル</th>
            <th>エンティティ数</th>
            <th>関係数</th>
            <th>作成日時</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id}>
              <td>Week {s.weekNumber}</td>
              <td>{s.label || '-'}</td>
              <td style={{ textAlign: 'center' }}>{s.entityCount}</td>
              <td style={{ textAlign: 'center' }}>{s.relationCount}</td>
              <td>{new Date(s.createdAt).toLocaleString('ja-JP')}</td>
              <td>
                <button onClick={() => setPreviewSnapshot(previewSnapshot?.id === s.id ? null : s)}>
                  {previewSnapshot?.id === s.id ? '閉じる' : 'プレビュー'}
                </button>
              </td>
            </tr>
          ))}
          {snapshots.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#999' }}>スナップショットなし</td></tr>
          )}
        </tbody>
      </table>

      {previewSnapshot && (
        <div style={{ marginTop: 24 }}>
          <h3>スナップショット内容 — Week {previewSnapshot.weekNumber} ({previewSnapshot.label})</h3>
          <pre style={{
            background: '#f5f5f5',
            padding: 16,
            borderRadius: 4,
            overflow: 'auto',
            maxHeight: 400,
            fontSize: 12,
          }}>
            {JSON.stringify(JSON.parse(previewSnapshot.data), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
