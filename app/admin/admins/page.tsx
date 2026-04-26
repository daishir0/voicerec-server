'use client';

import { useState, useEffect, useCallback } from 'react';

interface AdminUser {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const fetchAdmins = useCallback(async () => {
    const res = await fetch('/api/admin/admins');
    if (res.ok) setAdmins(await res.json());
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleCreate = async () => {
    if (!newUsername || !newPassword) return;
    await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: newPassword }),
    });
    setNewUsername('');
    setNewPassword('');
    fetchAdmins();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this admin?')) return;
    await fetch(`/api/admin/admins/${id}`, { method: 'DELETE' });
    fetchAdmins();
  };

  return (
    <>
      <h1>Admins</h1>
      <div className="form-row">
        <input type="text" placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
        <input type="password" placeholder="Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <button className="btn btn-primary" onClick={handleCreate}>Add Admin</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.id}>
              <td>{a.username}</td>
              <td>{a.role}</td>
              <td>{new Date(a.createdAt).toLocaleDateString()}</td>
              <td>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(a.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
