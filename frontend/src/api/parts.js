import { api } from './client';
export function getPart(id) {
    return api.get(`/parts/${id}`);
}
export function getPartDiff(id) {
    return api.get(`/parts/${id}/diff`);
}
