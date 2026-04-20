import { api } from './client';
import { Workspace } from '../types';

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
