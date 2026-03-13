export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  avatar_url: string;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  user?: User;
  error?: string;
}
