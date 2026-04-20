import { api } from './client';
import { Annotation, AnchorType, AnchorJson, AnnotationKind, ContentJson } from '../types';

export function getAnnotations(partId: string): Promise<{ annotations: Annotation[] }> {
  return api.get(`/parts/${partId}/annotations`);
}

export function createAnnotation(
  partId: string,
  data: {
    anchorType: AnchorType;
    anchorJson: AnchorJson;
    kind: AnnotationKind;
    contentJson: ContentJson;
    layerId?: string;
  },
): Promise<{ annotation: Annotation }> {
  return api.post(`/parts/${partId}/annotations`, data);
}

export function updateAnnotation(
  annotationId: string,
  data: {
    contentJson?: ContentJson;
    anchorJson?: AnchorJson;
    layerId?: string | null;
  },
): Promise<{ annotation: Annotation }> {
  return api.patch(`/annotations/${annotationId}`, data);
}

export function deleteAnnotation(annotationId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/annotations/${annotationId}`);
}
