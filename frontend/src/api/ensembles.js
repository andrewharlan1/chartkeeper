import { api } from './client';
export function createEnsemble(name) {
    return api.post('/ensembles', { name });
}
export function getEnsemble(id) {
    return api.get(`/ensembles/${id}`);
}
export function getMembers(ensembleId) {
    return api.get(`/ensembles/${ensembleId}/members`);
}
export function inviteMember(ensembleId, email, role) {
    return api.post(`/ensembles/${ensembleId}/invite`, { email, role });
}
