import { api } from './client';
import { Ensemble, EnsembleMember } from '../types';

export function createEnsemble(name: string): Promise<{ ensemble: Ensemble }> {
  return api.post('/ensembles', { name });
}

export function getEnsemble(id: string): Promise<{ ensemble: Ensemble }> {
  return api.get(`/ensembles/${id}`);
}

export function getMembers(ensembleId: string): Promise<{ members: EnsembleMember[] }> {
  return api.get(`/ensembles/${ensembleId}/members`);
}

export function inviteMember(
  ensembleId: string,
  email: string,
  role: 'editor' | 'player'
): Promise<{ inviteUrl: string }> {
  return api.post(`/ensembles/${ensembleId}/invite`, { email, role });
}
