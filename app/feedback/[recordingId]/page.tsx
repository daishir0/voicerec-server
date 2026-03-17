'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface Segment {
  text: string;
  start: number;
  end: number;
}

interface Correction {
  originalText: string;
  correctedTo: string;
  entityId: string;
  prefLabel: string;
  confidence: number;
}

interface SegmentResult {
  segmentIndex: number;
  originalText: string;
  correctedText: string;
  corrections: Correction[];
}

interface Domain {
  id: string;
  name: string;
}

interface SegmentFeedback {
  action: 'approve' | 'reject' | 'none';
  rejectText: string;
  comment: string;
  submitted: boolean;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function makeAuthHeader(username: string, password: string): string {
  return 'Basic ' + btoa(`${username}:${password}`);
}

export default function FeedbackPage() {
  const params = useParams();
  const recordingId = params.recordingId as string;

  // Auth state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [authError, setAuthError] = useState('');

  // Data state
  const [segments, setSegments] = useState<Segment[]>([]);
  const [results, setResults] = useState<SegmentResult[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [recordingName, setRecordingName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Feedback state per segment
  const [feedbacks, setFeedbacks] = useState<Record<number, SegmentFeedback>>({});

  // New term proposal
  const [newTerm, setNewTerm] = useState('');
  const [newReading, setNewReading] = useState('');
  const [termComment, setTermComment] = useState('');
  const [termSubmitted, setTermSubmitted] = useState(false);
  const [termError, setTermError] = useState('');

  const [submitMessage, setSubmitMessage] = useState('');

  const loadData = useCallback(async (auth: string, domainId: string) => {
    setLoading(true);
    setError('');
    try {
      // Load recording info
      const recRes = await fetch(`/api/recordings`, {
        headers: { Authorization: auth },
      });
      if (!recRes.ok) throw new Error('録音データの取得に失敗しました');
      const recs = await recRes.json();
      const rec = recs.find((r: { id: string; displayName?: string }) => r.id === recordingId);
      if (!rec) throw new Error('録音が見つかりません');
      setRecordingName(rec.displayName || rec.originalName || recordingId);

      if (rec.transcriptionSegments) {
        setSegments(JSON.parse(rec.transcriptionSegments));
      }

      // Load correction results
      const corrRes = await fetch(
        `/api/recordings/${recordingId}/correct/layer2?domainId=${domainId}&condition=proposed`,
        { headers: { Authorization: auth } }
      );

      if (corrRes.ok) {
        const corrData = await corrRes.json();
        if (corrData.results) {
          setResults(corrData.results);
        }
      } else {
        // Try layer1 only results via experiment endpoint
        const expRes = await fetch(
          `/api/recordings/${recordingId}/experiment?domainId=${domainId}`,
          { headers: { Authorization: auth } }
        );
        if (expRes.ok) {
          const expData = await expRes.json();
          if (expData.results) setResults(expData.results);
        }
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  const loadDomains = useCallback(async (auth: string) => {
    const res = await fetch('/api/ontology/domains', { headers: { Authorization: auth } });
    if (res.ok) {
      const data = await res.json();
      setDomains(data);
      if (data.length > 0) setSelectedDomain(data[0].id);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const auth = makeAuthHeader(username, password);
    // Verify credentials
    const res = await fetch('/api/recordings', { headers: { Authorization: auth } });
    if (!res.ok) {
      setAuthError('ユーザー名またはパスワードが間違っています');
      return;
    }
    setAuthHeader(auth);
    await loadDomains(auth);
  };

  useEffect(() => {
    if (authHeader && selectedDomain) {
      loadData(authHeader, selectedDomain);
    }
  }, [authHeader, selectedDomain, loadData]);

  const getFeedback = (idx: number): SegmentFeedback => {
    return feedbacks[idx] ?? { action: 'none', rejectText: '', comment: '', submitted: false };
  };

  const setFeedbackField = (idx: number, field: keyof SegmentFeedback, value: string | boolean) => {
    setFeedbacks((prev) => ({
      ...prev,
      [idx]: { ...getFeedback(idx), [field]: value },
    }));
  };

  const submitSegmentFeedback = async (result: SegmentResult) => {
    const fb = getFeedback(result.segmentIndex);
    if (fb.action === 'none') return;

    const payload = {
      domainId: selectedDomain,
      segmentIndex: result.segmentIndex,
      feedbackType: fb.action === 'approve' ? 'approve' : 'reject',
      originalText: result.originalText,
      correctedText: fb.action === 'reject' ? fb.rejectText || result.correctedText : result.correctedText,
      comment: fb.comment || undefined,
    };

    const res = await fetch(`/api/recordings/${recordingId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setFeedbackField(result.segmentIndex, 'submitted', true);
    }
  };

  const submitAllFeedbacks = async () => {
    setSubmitMessage('');
    const pending = results.filter((r) => {
      const fb = getFeedback(r.segmentIndex);
      return fb.action !== 'none' && !fb.submitted;
    });
    if (pending.length === 0) {
      setSubmitMessage('送信するフィードバックがありません');
      return;
    }
    await Promise.all(pending.map(submitSegmentFeedback));
    setSubmitMessage(`${pending.length}件のフィードバックを送信しました！`);
  };

  const submitNewTerm = async () => {
    setTermError('');
    if (!newTerm.trim()) {
      setTermError('用語名を入力してください');
      return;
    }
    const res = await fetch(`/api/recordings/${recordingId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        domainId: selectedDomain,
        segmentIndex: -1,
        feedbackType: 'suggest_term',
        originalText: newTerm,
        suggestedTerm: newTerm,
        suggestedReading: newReading || undefined,
        comment: termComment || undefined,
      }),
    });
    if (res.ok) {
      setTermSubmitted(true);
      setNewTerm('');
      setNewReading('');
      setTermComment('');
    } else {
      setTermError('送信に失敗しました');
    }
  };

  // --- Render: Login ---
  if (!authHeader) {
    return (
      <div style={styles.loginWrap}>
        <div style={styles.loginCard}>
          <h1 style={styles.loginTitle}>フィードバック入力</h1>
          <p style={styles.loginSub}>参加者ログイン</p>
          {authError && <div style={styles.errorBox}>{authError}</div>}
          <form onSubmit={handleLogin} style={styles.loginForm}>
            <input
              style={styles.input}
              type="text"
              placeholder="ユーザー名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <input
              style={styles.input}
              type="password"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button style={styles.btnPrimary} type="submit">ログイン</button>
          </form>
        </div>
      </div>
    );
  }

  // --- Render: Loading ---
  if (loading) {
    return <div style={styles.center}>読み込み中...</div>;
  }

  // --- Render: Error ---
  if (error) {
    return <div style={styles.center}><div style={styles.errorBox}>{error}</div></div>;
  }

  const submittedCount = Object.values(feedbacks).filter((f) => f.submitted).length;
  const pendingCount = Object.values(feedbacks).filter((f) => f.action !== 'none' && !f.submitted).length;

  // --- Render: Main ---
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>フィードバック入力</h1>
          <p style={styles.subtitle}>{recordingName}</p>
        </div>
        {domains.length > 1 && (
          <select
            style={styles.select}
            value={selectedDomain}
            onChange={(e) => setSelectedDomain(e.target.value)}
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>

      {results.length === 0 && (
        <div style={styles.emptyBox}>
          訂正結果がありません。管理者にお問い合わせください。
        </div>
      )}

      {results.map((result) => {
        const seg = segments[result.segmentIndex];
        const fb = getFeedback(result.segmentIndex);
        const hasCorrections = result.corrections && result.corrections.length > 0;

        return (
          <div
            key={result.segmentIndex}
            style={{
              ...styles.segmentCard,
              ...(fb.submitted ? styles.segmentSubmitted : {}),
            }}
          >
            <div style={styles.segmentHeader}>
              <span style={styles.segmentIndex}>セグメント {result.segmentIndex + 1}</span>
              {seg && (
                <span style={styles.timeRange}>
                  {formatTime(seg.start)} - {formatTime(seg.end)}
                </span>
              )}
              {fb.submitted && <span style={styles.badge}>送信済み</span>}
            </div>

            <div style={styles.textRow}>
              <div style={styles.textBlock}>
                <div style={styles.textLabel}>ASR原文</div>
                <div style={styles.textContent}>{result.originalText}</div>
              </div>
              <div style={styles.arrow}>→</div>
              <div style={styles.textBlock}>
                <div style={styles.textLabel}>訂正後</div>
                <div style={styles.textContent}>{result.correctedText}</div>
              </div>
            </div>

            {hasCorrections && (
              <div style={styles.correctionsWrap}>
                {result.corrections.map((c, ci) => (
                  <span key={ci} style={styles.correctionChip}>
                    {c.originalText} → <strong>{c.correctedTo}</strong>
                  </span>
                ))}
              </div>
            )}

            {!fb.submitted && (
              <div style={styles.actionRow}>
                <button
                  style={{
                    ...styles.btnApprove,
                    ...(fb.action === 'approve' ? styles.btnApproveActive : {}),
                  }}
                  onClick={() => setFeedbackField(result.segmentIndex, 'action', 'approve')}
                >
                  ✅ 承認
                </button>
                <button
                  style={{
                    ...styles.btnReject,
                    ...(fb.action === 'reject' ? styles.btnRejectActive : {}),
                  }}
                  onClick={() => setFeedbackField(result.segmentIndex, 'action', 'reject')}
                >
                  ❌ 却下
                </button>
                {fb.action === 'reject' && (
                  <input
                    style={styles.rejectInput}
                    type="text"
                    placeholder="正しいテキストを入力..."
                    value={fb.rejectText}
                    onChange={(e) => setFeedbackField(result.segmentIndex, 'rejectText', e.target.value)}
                  />
                )}
              </div>
            )}

            {!fb.submitted && (
              <input
                style={styles.commentInput}
                type="text"
                placeholder="コメント（任意）"
                value={fb.comment}
                onChange={(e) => setFeedbackField(result.segmentIndex, 'comment', e.target.value)}
              />
            )}
          </div>
        );
      })}

      {/* New term proposal */}
      <div style={styles.termCard}>
        <h2 style={styles.termTitle}>新用語を提案</h2>
        {termSubmitted && <div style={styles.successBox}>提案を送信しました！</div>}
        {termError && <div style={styles.errorBox}>{termError}</div>}
        <div style={styles.termRow}>
          <input
            style={styles.termInput}
            type="text"
            placeholder="用語名（例: COBOL）"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
          />
          <input
            style={styles.termInput}
            type="text"
            placeholder="読み（例: こぼる）"
            value={newReading}
            onChange={(e) => setNewReading(e.target.value)}
          />
          <input
            style={{ ...styles.termInput, flex: 2 }}
            type="text"
            placeholder="コメント（任意）"
            value={termComment}
            onChange={(e) => setTermComment(e.target.value)}
          />
          <button style={styles.btnPrimary} onClick={submitNewTerm}>送信</button>
        </div>
      </div>

      {/* Submit all button */}
      {results.length > 0 && (
        <div style={styles.submitRow}>
          {submittedCount > 0 && (
            <span style={styles.submitInfo}>{submittedCount}件送信済み</span>
          )}
          {submitMessage && <span style={styles.submitInfo}>{submitMessage}</span>}
          <button
            style={{ ...styles.btnPrimary, fontSize: 16, padding: '12px 32px' }}
            onClick={submitAllFeedbacks}
            disabled={pendingCount === 0}
          >
            フィードバックを一括送信 ({pendingCount}件)
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 800,
    margin: '0 auto',
    padding: '16px 16px 80px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#1a1a2e',
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  select: {
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #ccc',
    fontSize: 14,
  },
  segmentCard: {
    background: '#fff',
    borderRadius: 10,
    padding: '16px',
    marginBottom: 12,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    border: '1px solid #e5e5e5',
  },
  segmentSubmitted: {
    opacity: 0.6,
    background: '#f9f9f9',
  },
  segmentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  segmentIndex: {
    fontWeight: 700,
    fontSize: 13,
    color: '#555',
  },
  timeRange: {
    fontSize: 12,
    color: '#888',
    background: '#f0f0f0',
    padding: '2px 6px',
    borderRadius: 4,
  },
  badge: {
    fontSize: 11,
    color: '#fff',
    background: '#4a9eff',
    padding: '2px 8px',
    borderRadius: 10,
    marginLeft: 'auto',
  },
  textRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  textBlock: {
    flex: 1,
  },
  textLabel: {
    fontSize: 11,
    color: '#888',
    marginBottom: 2,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  textContent: {
    fontSize: 15,
    lineHeight: 1.5,
    color: '#222',
    wordBreak: 'break-all',
  },
  arrow: {
    fontSize: 18,
    color: '#999',
    paddingTop: 18,
    flexShrink: 0,
  },
  correctionsWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  correctionChip: {
    fontSize: 12,
    background: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: 4,
    padding: '2px 8px',
    color: '#856404',
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  btnApprove: {
    padding: '7px 16px',
    borderRadius: 6,
    border: '2px solid #28a745',
    background: '#fff',
    color: '#28a745',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  btnApproveActive: {
    background: '#28a745',
    color: '#fff',
  },
  btnReject: {
    padding: '7px 16px',
    borderRadius: 6,
    border: '2px solid #dc3545',
    background: '#fff',
    color: '#dc3545',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  btnRejectActive: {
    background: '#dc3545',
    color: '#fff',
  },
  rejectInput: {
    flex: 1,
    minWidth: 0,
    padding: '7px 12px',
    borderRadius: 6,
    border: '1px solid #ccc',
    fontSize: 13,
  },
  commentInput: {
    width: '100%',
    padding: '7px 12px',
    borderRadius: 6,
    border: '1px solid #e0e0e0',
    fontSize: 13,
    background: '#fafafa',
    marginTop: 4,
  },
  termCard: {
    background: '#fff',
    borderRadius: 10,
    padding: '16px',
    marginTop: 20,
    marginBottom: 12,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    border: '1px solid #e5e5e5',
  },
  termTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 12,
    color: '#1a1a2e',
  },
  termRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  termInput: {
    flex: 1,
    minWidth: 100,
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #ccc',
    fontSize: 13,
  },
  submitRow: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'rgba(255,255,255,0.95)',
    borderTop: '1px solid #e5e5e5',
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    zIndex: 100,
  },
  submitInfo: {
    fontSize: 13,
    color: '#555',
  },
  btnPrimary: {
    padding: '9px 20px',
    borderRadius: 6,
    border: 'none',
    background: '#4a9eff',
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  emptyBox: {
    padding: '24px',
    background: '#fff',
    borderRadius: 8,
    textAlign: 'center',
    color: '#888',
    border: '1px dashed #ccc',
    marginBottom: 16,
  },
  errorBox: {
    background: '#fff3f3',
    border: '1px solid #ffcccc',
    color: '#c00',
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 10,
  },
  successBox: {
    background: '#f0fff4',
    border: '1px solid #b7ebc8',
    color: '#155724',
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 10,
  },
  loginWrap: {
    minHeight: '100vh',
    background: '#f5f5f5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  loginCard: {
    background: '#fff',
    borderRadius: 12,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 360,
    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
  },
  loginTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: 6,
  },
  loginSub: {
    fontSize: 13,
    color: '#888',
    marginBottom: 20,
  },
  loginForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  input: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #ddd',
    fontSize: 15,
  },
  center: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
};
