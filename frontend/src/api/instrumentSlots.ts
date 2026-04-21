import { api } from './client';
import { InstrumentSlot } from '../types';

export function getInstrumentSlots(ensembleId: string): Promise<{ instrumentSlots: InstrumentSlot[] }> {
  return api.get(`/instrument-slots?ensembleId=${ensembleId}`);
}

export function getInstrumentSlot(id: string): Promise<{ instrumentSlot: InstrumentSlot }> {
  return api.get(`/instrument-slots/${id}`);
}

export function createInstrumentSlot(data: {
  ensembleId: string;
  name: string;
  section?: string;
}): Promise<{ instrumentSlot: InstrumentSlot }> {
  return api.post('/instrument-slots', data);
}

export function updateInstrumentSlot(id: string, data: {
  name?: string;
  section?: string | null;
}): Promise<{ instrumentSlot: InstrumentSlot }> {
  return api.patch(`/instrument-slots/${id}`, data);
}

export function deleteInstrumentSlot(id: string): Promise<{ deleted: boolean }> {
  return api.delete(`/instrument-slots/${id}`);
}

export interface SlotAssignmentUser {
  userId: string;
  name: string | null;
  email: string;
  isDummy: boolean;
}

export function getSlotAssignmentsByEnsemble(
  ensembleId: string,
): Promise<{ assignments: Record<string, SlotAssignmentUser[]> }> {
  return api.get(`/instrument-slots/assignments/by-ensemble?ensembleId=${ensembleId}`);
}

export function assignUserToSlot(slotId: string, userId: string): Promise<{ assignment: unknown }> {
  return api.post(`/instrument-slots/${slotId}/assignments`, { userId });
}

export function unassignUserFromSlot(slotId: string, userId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/instrument-slots/${slotId}/assignments/${userId}`);
}
