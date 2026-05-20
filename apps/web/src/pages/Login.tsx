import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Mail, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore, type AuthUser } from '../stores/auth.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const passwordSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type PasswordForm = z.infer<typeof passwordSchema>;

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

type AuthResponse = { access_token: string; user: AuthUser };
type WebAuthnOptions = { challenge: string; [k: string]: unknown };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Login(): React.ReactElement {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyEmail, setPasskeyEmail] = useState('');
  const [mode, setMode] = useState<'passkey' | 'password'>('passkey');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  // Password login mutation
  const passwordMutation = useMutation<AuthResponse, Error, PasswordForm>({
    mutationFn: async (data) => {
      const res = await api.post<AuthResponse>('/auth/login', data);
      return res.data;
    },
    onSuccess: (data) => {
      setAuth(data.access_token, data.user);
      void navigate({ to: '/' });
    },
  });

  // Passkey mutation (fetch options then call navigator.credentials.get)
  const passkeyMutation = useMutation<AuthResponse, Error, string>({
    mutationFn: async (email) => {
      setPasskeyError(null);

      // Step 1: get challenge from server
      const optRes = await api.get<WebAuthnOptions>('/auth/webauthn/authenticate-options', {
        params: { email },
      });
      const opts = optRes.data;

      // Step 2: prompt browser for passkey
      const challengeBuffer = base64UrlToBuffer(opts.challenge as string);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: challengeBuffer,
          timeout: 60000,
          userVerification: 'preferred',
          ...(opts as Omit<PublicKeyCredentialRequestOptions, 'challenge'>),
        },
      });

      if (!credential || credential.type !== 'public-key') {
        throw new Error('No passkey selected');
      }

      const pkc = credential as PublicKeyCredential;
      const response = pkc.response as AuthenticatorAssertionResponse;

      // Step 3: send assertion to server
      const verifyRes = await api.post<AuthResponse>('/auth/webauthn/authenticate', {
        id: pkc.id,
        rawId: bufferToBase64Url(pkc.rawId),
        type: pkc.type,
        response: {
          authenticatorData: bufferToBase64Url(response.authenticatorData),
          clientDataJSON: bufferToBase64Url(response.clientDataJSON),
          signature: bufferToBase64Url(response.signature),
          userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
        },
      });
      return verifyRes.data;
    },
    onSuccess: (data) => {
      setAuth(data.access_token, data.user);
      void navigate({ to: '/' });
    },
    onError: (err) => {
      setPasskeyError(err.message ?? 'Passkey authentication failed');
    },
  });

  const handlePasskeySignIn = (): void => {
    if (!passkeyEmail.trim()) {
      setPasskeyError('Enter your email first');
      return;
    }
    passkeyMutation.mutate(passkeyEmail);
  };

  const onPasswordSubmit = (data: PasswordForm): void => {
    passwordMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Sonalit</h1>
          <p className="text-gray-400 text-sm mt-1">Fleet operations platform</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 shadow-xl">
          {/* Mode tabs */}
          <div className="flex rounded-lg bg-gray-800 p-1 mb-6">
            <button
              type="button"
              onClick={() => setMode('passkey')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'passkey'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Passkey
            </button>
            <button
              type="button"
              onClick={() => setMode('password')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'password'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Password
            </button>
          </div>

          {/* Passkey form */}
          {mode === 'passkey' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="email"
                    value={passkeyEmail}
                    onChange={(e) => {
                      setPasskeyEmail(e.target.value);
                      setPasskeyError(null);
                    }}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>

              {passkeyError && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{passkeyError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handlePasskeySignIn}
                disabled={passkeyMutation.isPending}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
              >
                {passkeyMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
                Sign in with Passkey
              </button>
            </div>
          )}

          {/* Password form */}
          {mode === 'password' && (
            <form onSubmit={handleSubmit(onPasswordSubmit)} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="email"
                    {...register('email')}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                {errors.email && (
                  <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="password"
                    {...register('password')}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                {errors.password && (
                  <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>
                )}
              </div>

              {passwordMutation.isError && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{passwordMutation.error.message ?? 'Sign-in failed'}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={passwordMutation.isPending}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
              >
                {passwordMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
