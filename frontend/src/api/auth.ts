import { api } from './client';
import { User } from '../types';

interface AuthResponse {
  token: string;
  user: User;
}

export function signup(data: {
  email: string;
  name: string;
  password: string;
  inviteToken?: string;
}): Promise<AuthResponse> {
  return api.post('/auth/signup', data);
}

export function login(data: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return api.post('/auth/login', data);
}

export function acceptInvite(token: string, data: {
  email: string;
  password: string;
}): Promise<AuthResponse & { requiresSignup?: boolean; ensembleId?: string }> {
  return api.post(`/auth/accept-invite/${token}`, data);
}
