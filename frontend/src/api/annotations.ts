import { api } from './client';
import { Annotation, AnchorType, AnchorJson, ContentType } from '../types';

export function getAnnotations(partId: string): Promise<{ annotations: Annotation[] }> {
  return api.get(`/parts/${partId}/annotations`);
}

export function createAnnotation(
  partId: string,
  data: { anchorType: AnchorType; anchorJson: AnchorJson; contentType: ContentType; contentJson: Record<string, unknown> }
): Promise<{ annotation: Annotation }> {
  return api.post(`/parts/${partId}/annotations`, data);
}

export function updateAnnotation(annotationId: string, contentJson: Record<string, unknown>): Promise<{ annotation: Annotation }> {
  return api.patch(`/annotations/${annotationId}`, { contentJson });
}

export function deleteAnnotation(annotationId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/annotations/${annotationId}`);
}
