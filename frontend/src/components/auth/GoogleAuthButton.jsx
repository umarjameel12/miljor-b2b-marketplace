import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authApi } from '../../api/auth';

export function GoogleLogo({ className = 'w-4 h-4 shrink-0' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-8.97z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
      />
    </svg>
  );
}

export function GoogleAuthButton({
  label = 'Continue with Google',
  disabled = false,
  loading = false,
  onCredential,
  onBeforeClick,
  onError,
}) {
  const gsiContainerRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const [clientId, setClientId] = useState(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  const [gsiReady, setGsiReady] = useState(false);

  callbackRef.current = onCredential;

  useEffect(() => {
    let active = true;
    if (clientId) return undefined;
    authApi
      .getGoogleConfig()
      .then((res) => {
        if (active && res?.data?.enabled && res?.data?.client_id) {
          setClientId(res.data.client_id);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return undefined;

    const initGsi = () => {
      if (!window.google?.accounts?.id || !gsiContainerRef.current) return false;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response?.credential) {
            callbackRef.current?.(response.credential);
          } else {
            onError?.('Google did not return a valid credential.');
          }
        },
      });
      gsiContainerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(gsiContainerRef.current, {
        theme: 'outline',
        size: 'large',
        width: 400,
      });
      setGsiReady(true);
      return true;
    };

    if (initGsi()) return undefined;
    const timer = window.setInterval(() => {
      if (initGsi()) {
        window.clearInterval(timer);
      }
    }, 250);
    const stopTimer = window.setTimeout(() => window.clearInterval(timer), 8000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stopTimer);
    };
  }, [clientId, onError]);

  const handleWrapperClickCapture = (e) => {
    if (disabled || loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (onBeforeClick && onBeforeClick() === false) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!gsiReady) {
      e.preventDefault();
      e.stopPropagation();
      onError?.(
        clientId
          ? 'Google Sign-In is still loading or blocked by your browser. Please try again.'
          : 'Google Sign-In is not configured on this environment.'
      );
    }
  };

  return (
    <div
      data-testid="google-auth-wrapper"
      className="relative w-full"
      onClickCapture={handleWrapperClickCapture}
    >
      <button
        type="button"
        disabled={disabled || loading}
        aria-label={label}
        onClick={() => {
          if (onBeforeClick && onBeforeClick() === false) return;
          if (window.google?.accounts?.id) {
            window.google.accounts.id.prompt();
          }
        }}
        className="w-full h-11 px-4 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2.5 transition-all shadow-2xs hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
        }}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--brand-accent)' }} />
        ) : (
          <GoogleLogo />
        )}
        <span>{loading ? 'Connecting with Google…' : label}</span>
      </button>

      {gsiReady && !disabled && !loading && (
        <div
          ref={gsiContainerRef}
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.001] overflow-hidden flex items-center justify-center cursor-pointer"
        />
      )}
      {(!gsiReady || disabled || loading) && (
        <div ref={gsiContainerRef} className="hidden" aria-hidden="true" />
      )}
    </div>
  );
}
