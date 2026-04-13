import { api, multipartRequest } from './client';
export function createChart(data) {
    return api.post('/charts', data);
}
export function getChart(id) {
    return api.get(`/charts/${id}`);
}
export function getVersions(chartId) {
    return api.get(`/charts/${chartId}/versions`);
}
export function getVersion(chartId, versionId) {
    return api.get(`/charts/${chartId}/versions/${versionId}`);
}
export function uploadVersion(chartId, entries, versionName, inheritedPartNames) {
    const form = new FormData();
    if (versionName)
        form.append('versionName', versionName);
    const partTypes = {};
    const linkEntries = [];
    for (const entry of entries) {
        partTypes[entry.name] = entry.type;
        if (entry.type === 'link') {
            if (entry.url)
                linkEntries.push({ name: entry.name, url: entry.url });
        }
        else if (entry.file) {
            form.append(entry.name, entry.file);
        }
    }
    form.append('partTypes', JSON.stringify(partTypes));
    if (linkEntries.length > 0)
        form.append('linkEntries', JSON.stringify(linkEntries));
    if (inheritedPartNames)
        form.append('inheritedPartNames', JSON.stringify(inheritedPartNames));
    return multipartRequest(`/charts/${chartId}/versions`, form);
}
export function getAssignments(chartId) {
    return api.get(`/charts/${chartId}/assignments`);
}
export function assignPart(chartId, instrumentName, userId) {
    return api.post(`/charts/${chartId}/assignments`, { instrumentName, userId });
}
export function unassignPart(chartId, assignmentId) {
    return api.delete(`/charts/${chartId}/assignments/${assignmentId}`);
}
export function getPlayerParts() {
    return api.get('/player/parts');
}
export function restoreVersion(chartId, versionId) {
    return api.post(`/charts/${chartId}/versions/${versionId}/restore`);
}
export function deleteChart(chartId) {
    return api.delete(`/charts/${chartId}`);
}
export function deleteVersion(chartId, versionId) {
    return api.delete(`/charts/${chartId}/versions/${versionId}`);
}
export function deletePart(partId) {
    return api.delete(`/parts/${partId}`);
}
