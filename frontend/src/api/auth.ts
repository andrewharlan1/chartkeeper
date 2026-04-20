import { api } from './client';
import { User } from '../types';

interface SignupResponse {
  token: string;
  user: User;
  workspaceId: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

export function signup(data: {
  email: string;
  name: string;
  password: string;
}): Promise<SignupResponse> {
  return api.post('/auth/signup', data);
}

export function login(data: {
  email: string;
  password: string;
}): Promise<LoginResponse> {
  return api.post('/auth/login', data);
}
