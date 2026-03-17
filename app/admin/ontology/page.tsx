'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Domain {
  id: string;
  name: string;
  description: string;
  _count?: { entities: number };
}

interface Entity {
  id: string;
  prefLabel: string;
  altLabels: string[];
  phoneticHints: string[];
  category: string | null;
  source: string;
  isActive: boolean;
  relationCount: number;
}

export default function OntologyPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    prefLabel: '',
    altLabels: '',
    phoneticHints: '',
    definition: '',
    category: '',
  });
  const [domainForm, setDomainForm] = useState({ name: '', description: '' });

  useEffect(() => {
    fetchDomains();
  }, []);

  const fetchDomains = async () => {
    const res = await fetch('/api/ontology/domains', {
      headers: { Authorization: 'Basic ' + btoa('test1:test1pass') },
    });
    if (res.ok) {
      const data = await res.json();
      setDomains(data);
      if (data.length > 0 && !selectedDomain) {
        setSelectedDomain(data[0]);
      }
    }
  };

  const fetchEntities = useCallback(async (domainId: string, q?: string) => {
    setLoading(true);
    const url = `/api/ontology/domains/${domainId}/entities${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: 'Basic ' + btoa('test1:test1pass') },
    });
    if (res.ok) {
      const data = await res.json();
      setEntities(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedDomain) {
      fetchEntities(selectedDomain.id, searchQuery);
    }
  }, [selectedDomain, fetchEntities]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (selectedDomain) fetchEntities(selectedDomain.id, q);
  };

  const handleAddEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDomain) return;

    const res = await fetch(`/api/ontology/domains/${selectedDomain.id}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + btoa('test1:test1pass'),
      },
      body: JSON.stringify({
        prefLabel: form.prefLabel,
        altLabels: form.altLabels ? form.altLabels.split(',').map((s) => s.trim()) : [],
        phoneticHints: form.phoneticHints ? form.phoneticHints.split(',').map((s) => s.trim()) : [],
        definition: form.definition || undefined,
        category: form.category || undefined,
      }),
    });

    if (res.ok) {
      setForm({ prefLabel: '', altLabels: '', phoneticHints: '', definition: '', category: '' });
      setShowAddForm(false);
      fetchEntities(selectedDomain.id, searchQuery);
      fetchDomains();
    }
  };

  const handleEditEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntity || !selectedDomain) return;

    const res = await fetch(`/api/ontology/entities/${editingEntity.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + btoa('test1:test1pass'),
      },
      body: JSON.stringify({
        prefLabel: form.prefLabel,
        altLabels: form.altLabels ? form.altLabels.split(',').map((s) => s.trim()) : [],
        phoneticHints: form.phoneticHints ? form.phoneticHints.split(',').map((s) => s.trim()) : [],
        definition: form.definition || null,
        category: form.category || null,
      }),
    });

    if (res.ok) {
      setEditingEntity(null);
      setForm({ prefLabel: '', altLabels: '', phoneticHints: '', definition: '', category: '' });
      fetchEntities(selectedDomain.id, searchQuery);
    }
  };

  const handleDeleteEntity = async (id: string) => {
    if (!selectedDomain) return;
    if (!confirm('このエンティティを削除しますか？')) return;

    const res = await fetch(`/api/ontology/entities/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Basic ' + btoa('test1:test1pass') },
    });

    if (res.ok) {
      fetchEntities(selectedDomain.id, searchQuery);
      fetchDomains();
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/ontology/domains', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + btoa('test1:test1pass'),
      },
      body: JSON.stringify(domainForm),
    });

    if (res.ok) {
      setDomainForm({ name: '', description: '' });
      setShowAddDomain(false);
      fetchDomains();
    }
  };

  const startEdit = (entity: Entity) => {
    setEditingEntity(entity);
    setForm({
      prefLabel: entity.prefLabel,
      altLabels: entity.altLabels.join(', '),
      phoneticHints: entity.phoneticHints.join(', '),
      definition: '',
      category: entity.category || '',
    });
    setShowAddForm(false);
  };

  return (
    <div className="admin-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>オントロジー管理</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/admin/ontology/snapshots" className="btn-secondary">スナップショット</Link>
          <Link href="/admin/ontology/export" className="btn-secondary">エクスポート/インポート</Link>
          <button onClick={() => setShowAddDomain(true)} className="btn-primary">+ ドメイン追加</button>
        </div>
      </div>

      {showAddDomain && (
        <div className="modal-overlay" onClick={() => setShowAddDomain(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>ドメイン追加</h2>
            <form onSubmit={handleAddDomain}>
              <div className="form-group">
                <label>ドメイン名（A/B/C/D）</label>
                <input
                  value={domainForm.name}
                  onChange={(e) => setDomainForm({ ...domainForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>説明</label>
                <input
                  value={domainForm.description}
                  onChange={(e) => setDomainForm({ ...domainForm, description: e.target.value })}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowAddDomain(false)}>キャンセル</button>
                <button type="submit" className="btn-primary">作成</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ドメインタブ */}
      <div className="tab-bar">
        {domains.map((d) => (
          <button
            key={d.id}
            className={`tab ${selectedDomain?.id === d.id ? 'active' : ''}`}
            onClick={() => {
              setSelectedDomain(d);
              setSearchQuery('');
              setShowAddForm(false);
              setEditingEntity(null);
            }}
          >
            ドメイン{d.name}
            <span className="badge">{d._count?.entities ?? 0}</span>
          </button>
        ))}
      </div>

      {selectedDomain && (
        <div>
          <div className="domain-summary">
            <strong>{selectedDomain.description}</strong>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <input
              type="search"
              placeholder="エンティティを検索..."
              value={searchQuery}
              onChange={handleSearch}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #ddd' }}
            />
            <button onClick={() => { setShowAddForm(true); setEditingEntity(null); setForm({ prefLabel: '', altLabels: '', phoneticHints: '', definition: '', category: '' }); }} className="btn-primary">
              + エンティティ追加
            </button>
          </div>

          {(showAddForm || editingEntity) && (
            <form onSubmit={editingEntity ? handleEditEntity : handleAddEntity} className="inline-form">
              <h3>{editingEntity ? 'エンティティ編集' : 'エンティティ追加'}</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>prefLabel（正式名称） *</label>
                  <input value={form.prefLabel} onChange={(e) => setForm({ ...form, prefLabel: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>altLabels（カンマ区切り）</label>
                  <input value={form.altLabels} onChange={(e) => setForm({ ...form, altLabels: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>phoneticHints（読み仮名、カンマ区切り）</label>
                  <input value={form.phoneticHints} onChange={(e) => setForm({ ...form, phoneticHints: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>カテゴリ</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>定義</label>
                  <input value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn-primary">{editingEntity ? '更新' : '追加'}</button>
                <button type="button" onClick={() => { setShowAddForm(false); setEditingEntity(null); }}>キャンセル</button>
              </div>
            </form>
          )}

          {loading ? (
            <p>読み込み中...</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>prefLabel</th>
                  <th>altLabels</th>
                  <th>phoneticHints</th>
                  <th>カテゴリ</th>
                  <th>関係数</th>
                  <th>source</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/admin/ontology/${e.id}`} style={{ fontWeight: 600 }}>
                        {e.prefLabel}
                      </Link>
                    </td>
                    <td style={{ fontSize: 12 }}>{e.altLabels.join(', ')}</td>
                    <td style={{ fontSize: 12 }}>{e.phoneticHints.join(', ')}</td>
                    <td>{e.category}</td>
                    <td style={{ textAlign: 'center' }}>{e.relationCount}</td>
                    <td><span className="badge">{e.source}</span></td>
                    <td>
                      <button onClick={() => startEdit(e)} style={{ marginRight: 4 }}>編集</button>
                      <button onClick={() => handleDeleteEntity(e.id)} className="btn-danger">削除</button>
                    </td>
                  </tr>
                ))}
                {entities.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: '#999' }}>エンティティなし</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {domains.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          <p>ドメインが未作成です。「ドメイン追加」ボタンから作成してください。</p>
        </div>
      )}
    </div>
  );
}
