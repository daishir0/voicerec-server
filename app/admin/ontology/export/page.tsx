'use client';

import { useState, useEffect, useRef } from 'react';

interface Domain {
  id: string;
  name: string;
  description: string;
}

export default function ExportPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [mode, setMode] = useState<'full' | 'flat'>('full');
  const [importPreview, setImportPreview] = useState<{ entities: number; relations: number } | null>(null);
  const [importData, setImportData] = useState<string>('');
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const auth = 'Basic ' + btoa('test1:test1pass');

  useEffect(() => {
    fetch('/api/ontology/domains', { headers: { Authorization: auth } })
      .then((r) => r.json())
      .then((data) => {
        setDomains(data);
        if (data.length > 0) setSelectedDomain(data[0]);
      });
  }, []);

  const handleExport = async () => {
    if (!selectedDomain) return;
    const url = `/api/ontology/domains/${selectedDomain.id}/export${mode === 'flat' ? '?mode=flat' : ''}`;
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) return;
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ontology_domain${selectedDomain.name}_${mode}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setImportData(text);
      try {
        const parsed = JSON.parse(text);
        const entities = parsed.entities?.length ?? parsed.terms?.length ?? 0;
        const relations = parsed.relations?.length ?? 0;
        setImportPreview({ entities, relations });
      } catch {
        setImportPreview(null);
        setMessage('JSONの解析に失敗しました');
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!selectedDomain || !importData) return;
    if (!confirm(`ドメイン${selectedDomain.name}にインポートしますか？既存エンティティは更新されます。`)) return;

    const res = await fetch(`/api/ontology/domains/${selectedDomain.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: importData,
    });

    if (res.ok) {
      const result = await res.json();
      setMessage(`インポート完了: エンティティ ${result.imported.entities}件、関係 ${result.imported.relations}件`);
      setImportData('');
      setImportPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } else {
      const err = await res.json();
      setMessage('エラー: ' + (err.error || 'unknown'));
    }
  };

  return (
    <div className="admin-page">
      <h1>エクスポート / インポート</h1>

      <div style={{ marginBottom: 24 }}>
        <label>ドメイン選択: </label>
        <select value={selectedDomain?.id || ''} onChange={(e) => {
          setSelectedDomain(domains.find((d) => d.id === e.target.value) || null);
          setImportPreview(null);
          setImportData('');
          setMessage('');
        }}>
          {domains.map((d) => <option key={d.id} value={d.id}>ドメイン{d.name} — {d.description}</option>)}
        </select>
      </div>

      {message && <div className="message-box">{message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* エクスポート */}
        <div className="card">
          <h2>エクスポート</h2>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>エクスポートモード</label>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <label>
                <input type="radio" value="full" checked={mode === 'full'} onChange={() => setMode('full')} />
                {' '}フル（Proposed用）— エンティティ＋関係
              </label>
              <label>
                <input type="radio" value="flat" checked={mode === 'flat'} onChange={() => setMode('flat')} />
                {' '}フラット（B3用）— prefLabel＋altLabels＋phoneticHintsのみ
              </label>
            </div>
          </div>
          <button onClick={handleExport} className="btn-primary" disabled={!selectedDomain}>
            JSONダウンロード
          </button>
          {mode === 'flat' && (
            <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
              ※ B3用: 定義・カテゴリ・関係を除去した論文§5.3「同一語彙セットのフラットリスト」形式
            </p>
          )}
        </div>

        {/* インポート */}
        <div className="card">
          <h2>インポート</h2>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>JSONファイルをアップロード</label>
            <input ref={fileRef} type="file" accept=".json" onChange={handleFileChange} style={{ marginTop: 8 }} />
          </div>

          {importPreview && (
            <div className="preview-box">
              <strong>インポート内容プレビュー</strong>
              <p>エンティティ: {importPreview.entities}件</p>
              <p>関係: {importPreview.relations}件</p>
            </div>
          )}

          <button onClick={handleImport} className="btn-primary" disabled={!selectedDomain || !importData}>
            インポート実行
          </button>
        </div>
      </div>
    </div>
  );
}
