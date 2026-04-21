import { api } from './client';
import { Workspace, WorkspaceMember } from '../types';

export function getWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  return api.get('/workspaces');
}

export function getWorkspace(id: string): Promise<{ workspace: Workspace }> {
  return api.get(`/workspaces/${id}`);
}

export function createWorkspace(name: string): Promise<{ workspace: Workspace }> {
  return api.post('/workspaces', { name });
}

export function updateWorkspace(id: string, name: string): Promise<{ workspace: Workspace }> {
  return api.patch(`/workspaces/${id}`, { name });
}

export function deleteWorkspace(id: string): Promise<{ deleted: boolean }> {
  return api.delete(`/workspaces/${id}`);
}

export function getWorkspaceMembers(id: string): Promise<{ members: WorkspaceMember[] }> {
  return api.get(`/workspaces/${id}/members`);
}

export function addWorkspaceMember(workspaceId: string, data: {
  name: string;
  email?: string;
  role?: string;
  isDummy?: boolean;
}): Promise<{ member: WorkspaceMember }> {
  return api.post(`/workspaces/${workspaceId}/members`, data);
}

export function removeWorkspaceMember(workspaceId: string, userId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/workspaces/${workspaceId}/members/${userId}`);
}

export function seedDummyMembers(workspaceId: string): Promise<{ seeded: number; members: WorkspaceMember[] }> {
  return api.post(`/workspaces/${workspaceId}/seed-dummies`);
}
