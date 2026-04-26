'use client';

import { useEffect, useState } from 'react';

const LANGUAGE_OPTIONS = [
  { value: 'ja', label: '日本語 (Japanese)' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文 (Chinese)' },
  { value: 'ko', label: '한국어 (Korean)' },
  { value: 'es', label: 'Español (Spanish)' },
  { value: 'fr', label: 'Français (French)' },
  { value: 'de', label: 'Deutsch (German)' },
  { value: 'it', label: 'Italiano (Italian)' },
  { value: 'pt', label: 'Português (Portuguese)' },
  { value: 'ru', label: 'Русский (Russian)' },
];

interface UserSettings {
  id: string;
  username: string;
  transcriptionLanguage: string;
}

interface McpStatus {
  hasCredentials: boolean;
  clientId: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  mcpUrl: string | null;
}

interface McpIssued {
  clientId: string;
  clientSecret: string;
  mcpUrl: string | null;
  createdAt: string;
}

export default function UserSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [language, setLanguage] = useState('ja');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [mcpIssued, setMcpIssued] = useState<McpIssued | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);

  const loadMcp = () => {
    fetch('/user/api/mcp-credentials')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: McpStatus | null) => {
        if (data) setMcpStatus(data);
      });
  };

  useEffect(() => {
    fetch('/user/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: UserSettings | null) => {
        if (data) {
          setSettings(data);
          setLanguage(data.transcriptionLanguage);
        }
      });
    loadMcp();
  }, []);

  const handleIssueMcp = async () => {
    if (mcpStatus?.hasCredentials && !confirm('既存のクレデンシャルを上書きします。よろしいですか？')) {
      return;
    }
    setMcpBusy(true);
    try {
      const res = await fetch('/user/api/mcp-credentials', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const issued: McpIssued = await res.json();
      setMcpIssued(issued);
      loadMcp();
    } catch (err) {
      alert('発行失敗: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setMcpBusy(false);
    }
  };

  const handleRevokeMcp = async () => {
    if (!confirm('このMCPクレデンシャルを失効させます。よろしいですか？')) return;
    setMcpBusy(true);
    try {
      await fetch('/user/api/mcp-credentials', { method: 'DELETE' });
      setMcpIssued(null);
      loadMcp();
    } finally {
      setMcpBusy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/user/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcriptionLanguage: language }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      const updated = await res.json();
      setSettings(updated);
      setSavedAt(new Date().toLocaleTimeString('ja-JP'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>設定</h1>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>文字起こし言語</h2>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          新規アップロードされた録音はこの言語で文字起こしされます。
        </p>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={{
            width: '100%',
            height: 40,
            borderRadius: 6,
            border: '1px solid #ccc',
            padding: '0 12px',
            fontSize: 14,
          }}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleSave}
            disabled={saving || language === settings.transcriptionLanguage}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: '#0070f3',
              color: 'white',
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving || language === settings.transcriptionLanguage ? 0.5 : 1,
            }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
          {savedAt && <span style={{ fontSize: 12, color: '#34c759' }}>保存しました ({savedAt})</span>}
          {error && <span style={{ fontSize: 12, color: '#ff3b30' }}>{error}</span>}
        </div>
      </section>

      <section style={{ marginBottom: 32, borderTop: '1px solid #eee', paddingTop: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>MCP 接続 (Claude.ai 連携)</h2>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Claude.ai から自分の録音データを自然言語で検索できるようにする MCP クレデンシャルを発行します。
          発行後、Client Secret は <strong>一度だけ</strong> 表示されます。
        </p>

        {mcpStatus && (
          <div style={{ fontSize: 13, marginBottom: 12, padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
            {mcpStatus.hasCredentials ? (
              <>
                {mcpStatus.mcpUrl && (
                  <div style={{ marginBottom: 4, wordBreak: 'break-all' }}>
                    MCP URL: <code style={{ userSelect: 'all' }}>{mcpStatus.mcpUrl}</code>
                  </div>
                )}
                <div style={{ marginBottom: 4 }}>
                  Client ID: <code style={{ userSelect: 'all' }}>{mcpStatus.clientId}</code>
                </div>
                <div style={{ color: '#999', fontSize: 12 }}>
                  Client Secret: (発行時にのみ表示。必要なら再発行してください)
                </div>
                <div style={{ marginTop: 6, color: '#666', fontSize: 12 }}>
                  発行日: {mcpStatus.createdAt ? new Date(mcpStatus.createdAt).toLocaleString('ja-JP') : '-'}
                  {' / '}
                  最終使用: {mcpStatus.lastUsedAt ? new Date(mcpStatus.lastUsedAt).toLocaleString('ja-JP') : '未使用'}
                </div>
              </>
            ) : (
              <div style={{ color: '#999' }}>未発行</div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleIssueMcp}
            disabled={mcpBusy}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: '#5856d6',
              color: 'white',
              cursor: mcpBusy ? 'wait' : 'pointer',
              opacity: mcpBusy ? 0.5 : 1,
            }}
          >
            {mcpBusy ? '処理中...' : (mcpStatus?.hasCredentials ? '再発行' : '発行')}
          </button>
          {mcpStatus?.hasCredentials && (
            <button
              onClick={handleRevokeMcp}
              disabled={mcpBusy}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: '1px solid #ff3b30',
                background: 'white',
                color: '#ff3b30',
                cursor: mcpBusy ? 'wait' : 'pointer',
              }}
            >
              失効
            </button>
          )}
        </div>

        {mcpIssued && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: '#fff9e6',
              border: '1px solid #ffd633',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              ⚠️ Client Secret は以下に表示されるものが唯一の機会です。安全な場所に保管してください。
            </div>
            <div style={{ marginBottom: 10, color: '#7a4500' }}>
              Claude.ai の <strong>Settings → Connectors → Add custom connector</strong> で以下の3つを設定してください:
            </div>
            {mcpIssued.mcpUrl && (
              <div style={{ marginBottom: 8, wordBreak: 'break-all' }}>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>① Remote MCP server URL</div>
                <code
                  style={{
                    display: 'block',
                    padding: '6px 10px',
                    background: 'white',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    userSelect: 'all',
                  }}
                >
                  {mcpIssued.mcpUrl}
                </code>
              </div>
            )}
            <div style={{ marginBottom: 8, wordBreak: 'break-all' }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>② OAuth Client ID</div>
              <code
                style={{
                  display: 'block',
                  padding: '6px 10px',
                  background: 'white',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  userSelect: 'all',
                }}
              >
                {mcpIssued.clientId}
              </code>
            </div>
            <div style={{ marginBottom: 8, wordBreak: 'break-all' }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>③ OAuth Client Secret</div>
              <code
                style={{
                  display: 'block',
                  padding: '6px 10px',
                  background: 'white',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  userSelect: 'all',
                }}
              >
                {mcpIssued.clientSecret}
              </code>
            </div>
            <button
              onClick={() => setMcpIssued(null)}
              style={{ marginTop: 8, padding: '4px 12px', fontSize: 12 }}
            >
              閉じる
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
