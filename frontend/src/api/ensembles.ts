import { api } from './client';
import { Ensemble, EnsembleMember, EnsembleInstrument, EnsembleInstrumentAssignment } from '../types';

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

export function getMyEnsembles(): Promise<{ ensembles: (Ensemble & { role: string })[] }> {
  return api.get('/ensembles');
}

export function deleteEnsemble(ensembleId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/ensembles/${ensembleId}`);
}

export function addDummyMembers(ensembleId: string): Promise<{ added: number }> {
  return api.post(`/ensembles/${ensembleId}/seed-members`, {});
}

export function getInstruments(ensembleId: string): Promise<{ instruments: EnsembleInstrument[] }> {
  return api.get(`/ensembles/${ensembleId}/instruments`);
}

export function addInstrument(ensembleId: string, name: string): Promise<{ instrument: EnsembleInstrument }> {
  return api.post(`/ensembles/${ensembleId}/instruments`, { name });
}

export function renameInstrument(ensembleId: string, instrumentId: string, name: string): Promise<{ instrument: EnsembleInstrument }> {
  return api.patch(`/ensembles/${ensembleId}/instruments/${instrumentId}`, { name });
}

export function removeInstrument(ensembleId: string, instrumentId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/ensembles/${ensembleId}/instruments/${instrumentId}`);
}

export function getInstrumentAssignments(ensembleId: string, instrumentId: string): Promise<{ assignments: EnsembleInstrumentAssignment[] }> {
  return api.get(`/ensembles/${ensembleId}/instruments/${instrumentId}/assignments`);
}

export function assignInstrumentMember(ensembleId: string, instrumentId: string, userId: string): Promise<{ assignment: EnsembleInstrumentAssignment }> {
  return api.post(`/ensembles/${ensembleId}/instruments/${instrumentId}/assignments`, { userId });
}

export function unassignInstrumentMember(ensembleId: string, instrumentId: string, assignmentId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/ensembles/${ensembleId}/instruments/${instrumentId}/assignments/${assignmentId}`);
}
