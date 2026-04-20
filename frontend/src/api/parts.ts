import { api } from './client';
import { Part, PartDiff, MeasureLayoutItem } from '../types';

export function getPart(id: string): Promise<{ part: Part }> {
  return api.get(`/parts/${id}`);
}

export function getPartDiff(id: string): Promise<{ diff: PartDiff | null }> {
  return api.get(`/parts/${id}/diff`);
}

export function getMeasureLayout(partId: string): Promise<{ measureLayout: MeasureLayoutItem[] }> {
  return api.get(`/parts/${partId}/measure-layout`);
}

export function detectMeasureNumber(partId: string, imageBase64: string, cx?: number, cy?: number): Promise<{ measureNumber: number }> {
  return api.post(`/parts/${partId}/detect-measure`, { imageBase64, cx, cy });
}
