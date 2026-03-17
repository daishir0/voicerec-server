'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Entity {
  id: string;
  domainId: string;
  prefLabel: string;
  altLabels: string[];
  phoneticHints: string[];
  definition: string | null;
  category: string | null;
  isActive: boolean;
  source: string;
}

interface Relation {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  cooccurrenceWeight: number;
  source: string;
  fromEntity: { id: string; prefLabel: string };
  toEntity: { id: string; prefLabel: string };
}

interface DomainEntity {
  id: string;
  prefLabel: string;
}

const RELATION_TYPES = ['broader', 'narrower', 'isPartOf', 'isUsedIn', 'relatedTo', 'controls'];

export default function EntityDetailPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const router = useRouter();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [domainEntities, setDomainEntities] = useState<DomainEntity[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    prefLabel: '',
    altLabels: '',
    phoneticHints: '',
    definition: '',
    category: '',
  });
  const [relForm, setRelForm] = useState({
    toEntityId: '',
    relationType: 'relatedTo',
    cooccurrenceWeight: '0',
  });

  const auth = 'Basic ' + btoa('test1:test1pass');

  const fetchEntity = async () => {
    // Fetch entity via domain entities list
    const domainsRes = await fetch('/api/ontology/domains', { headers: { Authorization: auth } });
    if (!domainsRes.ok) return;
    const domains = await domainsRes.json();

    for (const d of domains) {
      const res = await fetch(`/api/ontology/domains/${d.id}/entities`, { headers: { Authorization: auth } });
      if (!res.ok) continue;
      const list: Entity[] = await res.json();
      const found = list.find((e) => e.id === entityId);
      if (found) {
        setEntity(found);
        setForm({
          prefLabel: found.prefLabel,
          altLabels: found.altLabels.join(', '),
          phoneticHints: found.phoneticHints.join(', '),
          definition: found.definition || '',
          category: found.category || '',
        });
        // Fetch domain entities for relation form
        setDomainEntities(list.filter((e) => e.id !== entityId).map((e) => ({ id: e.id, prefLabel: e.prefLabel })));
        break;
      }
    }
  };

  const fetchRelations = async () => {
    const res = await fetch(`/api/ontology/entities/${entityId}/relations`, { headers: { Authorization: auth } });
    if (res.ok) setRelations(await res.json());
  };

  useEffect(() => {
    fetchEntity();
    fetchRelations();
  }, [entityId]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`/api/ontology/entities/${entityId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        prefLabel: form.prefLabel,
        altLabels: form.altLabels ? form.altLabels.split(',').map((s) => s.trim()) : [],
        phoneticHints: form.phoneticHints ? form.phoneticHints.split(',').map((s) => s.trim()) : [],
        definition: form.definition || null,
        category: form.category || null,
      }),
    });
    if (res.ok) {
      setEditing(false);
      fetchEntity();
    }
  };

  const handleAddRelation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entity) return;
    const res = await fetch('/api/ontology/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        fromEntityId: entity.id,
        toEntityId: relForm.toEntityId,
        relationType: relForm.relationType,
        cooccurrenceWeight: parseFloat(relForm.cooccurrenceWeight) || 0,
      }),
    });
    if (res.ok) {
      setRelForm({ toEntityId: '', relationType: 'relatedTo', cooccurrenceWeight: '0' });
      fetchRelations();
    }
  };

  const handleDeleteRelation = async (id: string) => {
    if (!confirm('この関係を削除しますか？')) return;
    const res = await fetch(`/api/ontology/relations/${id}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    if (res.ok) fetchRelations();
  };

  if (!entity) return <div className="admin-page"><p>読み込み中...</p></div>;

  return (
    <div className="admin-page">
      <div style={{ marginBottom: 16 }}>
        <Link href="/admin/ontology">← オントロジー一覧に戻る</Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>{entity.prefLabel}</h1>
        <button onClick={() => setEditing(!editing)} className="btn-primary">
          {editing ? 'キャンセル' : '編集'}
        </button>
      </div>

      {editing ? (
        <form onSubmit={handleUpdate} className="inline-form">
          <div className="form-row">
            <div className="form-group">
              <label>prefLabel *</label>
              <input value={form.prefLabel} onChange={(e) => setForm({ ...form, prefLabel: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>altLabels（カンマ区切り）</label>
              <input value={form.altLabels} onChange={(e) => setForm({ ...form, altLabels: e.target.value })} />
            </div>
            <div className="form-group">
              <label>phoneticHints（カンマ区切り）</label>
              <input value={form.phoneticHints} onChange={(e) => setForm({ ...form, phoneticHints: e.target.value })} />
            </div>
            <div className="form-group">
              <label>カテゴリ</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div className="form-group">
              <label>定義</label>
              <textarea value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} rows={3} />
            </div>
          </div>
          <button type="submit" className="btn-primary">更新</button>
        </form>
      ) : (
        <div className="detail-card">
          <div className="detail-row"><span className="detail-label">prefLabel</span><span>{entity.prefLabel}</span></div>
          <div className="detail-row"><span className="detail-label">altLabels</span><span>{entity.altLabels.join(', ') || '-'}</span></div>
          <div className="detail-row"><span className="detail-label">phoneticHints</span><span>{entity.phoneticHints.join(', ') || '-'}</span></div>
          <div className="detail-row"><span className="detail-label">カテゴリ</span><span>{entity.category || '-'}</span></div>
          <div className="detail-row"><span className="detail-label">定義</span><span>{entity.definition || '-'}</span></div>
          <div className="detail-row"><span className="detail-label">source</span><span><span className="badge">{entity.source}</span></span></div>
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>関係</h2>

      <form onSubmit={handleAddRelation} className="inline-form" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <div className="form-group">
            <label>対象エンティティ</label>
            <select value={relForm.toEntityId} onChange={(e) => setRelForm({ ...relForm, toEntityId: e.target.value })} required>
              <option value="">-- 選択 --</option>
              {domainEntities.map((e) => (
                <option key={e.id} value={e.id}>{e.prefLabel}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>関係タイプ</label>
            <select value={relForm.relationType} onChange={(e) => setRelForm({ ...relForm, relationType: e.target.value })}>
              {RELATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>cooccurrenceWeight (0-1)</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={relForm.cooccurrenceWeight}
              onChange={(e) => setRelForm({ ...relForm, cooccurrenceWeight: e.target.value })}
            />
          </div>
        </div>
        <button type="submit" className="btn-primary">関係追加</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            <th>from</th>
            <th>relationType</th>
            <th>to</th>
            <th>weight</th>
            <th>source</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {relations.map((r) => (
            <tr key={r.id}>
              <td>{r.fromEntity.prefLabel}</td>
              <td><code>{r.relationType}</code></td>
              <td>{r.toEntity.prefLabel}</td>
              <td>{r.cooccurrenceWeight}</td>
              <td><span className="badge">{r.source}</span></td>
              <td>
                <button onClick={() => handleDeleteRelation(r.id)} className="btn-danger">削除</button>
              </td>
            </tr>
          ))}
          {relations.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#999' }}>関係なし</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
