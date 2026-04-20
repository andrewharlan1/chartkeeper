import { api } from './client';
import { Ensemble } from '../types';

export function getEnsembles(workspaceId: string): Promise<{ ensembles: Ensemble[] }> {
  return api.get(`/ensembles?workspaceId=${workspaceId}`);
}

export function getEnsemble(id: string): Promise<{ ensemble: Ensemble }> {
  return api.get(`/ensembles/${id}`);
}

export function createEnsemble(workspaceId: string, name: string): Promise<{ ensemble: Ensemble }> {
  return api.post('/ensembles', { workspaceId, name });
}

export function updateEnsemble(id: string, name: string): Promise<{ ensemble: Ensemble }> {
  return api.patch(`/ensembles/${id}`, { name });
}

export function deleteEnsemble(id: string): Promise<{ deleted: boolean }> {
  return api.delete(`/ensembles/${id}`);
}
