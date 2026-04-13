import { api } from './client';
import { Part, PartDiff } from '../types';

export function getPart(id: string): Promise<{ part: Part }> {
  return api.get(`/parts/${id}`);
}

export function getPartDiff(id: string): Promise<{ diff: PartDiff | null }> {
  return api.get(`/parts/${id}/diff`);
}
