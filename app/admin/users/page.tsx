'use client';

import { useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  username: string;
  createdAt: string;
  _count: { recordings: number };
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/admin/api/users');
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async () => {
    if (!newUsername || !newPassword) return;
    await fetch('/admin/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: newPassword }),
    });
    setNewUsername('');
    setNewPassword('');
    fetchUsers();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user and all their recordings?')) return;
    await fetch(`/admin/api/users/${id}`, { method: 'DELETE' });
    fetchUsers();
  };

  return (
    <>
      <h1>Users</h1>
      <div className="form-row">
        <input type="text" placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
        <input type="password" placeholder="Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <button className="btn btn-primary" onClick={handleCreate}>Add User</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Recordings</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u._count.recordings}</td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
