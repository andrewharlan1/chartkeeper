const BASE = '/api';
export class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
async function request(method, path, body) {
    const token = localStorage.getItem('token');
    const headers = {};
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    if (body !== undefined)
        headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, data.error ?? res.statusText);
    }
    if (res.status === 204)
        return undefined;
    return res.json();
}
export async function multipartRequest(path, formData) {
    const token = localStorage.getItem('token');
    const headers = {};
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
        body: formData,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, data.error ?? res.statusText);
    }
    return res.json();
}
export const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
};
