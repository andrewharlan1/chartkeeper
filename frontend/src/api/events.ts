import { api } from './client';

export interface Event {
  id: string;
  ensembleId: string;
  name: string;
  eventType: 'gig' | 'rehearsal' | 'recording' | 'workshop' | 'other';
  startsAt: string;
  location: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface EventChart {
  id: string;
  chartId: string;
  sortOrder: number;
  chartName: string;
  chartComposer: string | null;
}

export interface MyEvent extends Event {
  ensembleName: string;
  charts: Array<{ eventId: string; chartId: string; sortOrder: number; chartName: string }>;
}

export function getEnsembleEvents(ensembleId: string) {
  return api.get<{ events: Event[] }>(`/ensembles/${ensembleId}/events`);
}

export function createEvent(ensembleId: string, data: {
  name: string;
  eventType?: string;
  startsAt: string;
  location?: string;
  notes?: string;
}) {
  return api.post<{ event: Event }>(`/ensembles/${ensembleId}/events`, data);
}

export function getEvent(eventId: string) {
  return api.get<{ event: Event; charts: EventChart[] }>(`/events/${eventId}`);
}

export function updateEvent(eventId: string, data: Partial<{
  name: string;
  eventType: string;
  startsAt: string;
  location: string | null;
  notes: string | null;
}>) {
  return api.patch<{ event: Event }>(`/events/${eventId}`, data);
}

export function deleteEvent(eventId: string) {
  return api.delete<{ deleted: boolean }>(`/events/${eventId}`);
}

export function addChartToEvent(eventId: string, chartId: string, sortOrder?: number) {
  return api.post<{ eventChart: { id: string; eventId: string; chartId: string; sortOrder: number } }>(
    `/events/${eventId}/charts`,
    { chartId, sortOrder },
  );
}

export function removeChartFromEvent(eventId: string, chartId: string) {
  return api.delete<{ deleted: boolean }>(`/events/${eventId}/charts/${chartId}`);
}

export function reorderEventCharts(eventId: string, chartIds: string[]) {
  return api.put<{ reordered: boolean }>(`/events/${eventId}/charts/order`, { chartIds });
}

export function getMyEvents() {
  return api.get<{ events: MyEvent[] }>('/me/events');
}
