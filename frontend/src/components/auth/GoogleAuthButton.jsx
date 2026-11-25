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
  const renderedClientIdRef = useRef('');
  const callbackRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const [clientId, setClientId] = useState(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  const [gsiReady, setGsiReady] = useState(false);

  useEffect(() => {
    callbackRef.current = onCredential;
    onErrorRef.current = onError;
  }, [onCredential, onError]);

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
      if (renderedClientIdRef.current === clientId && gsiContainerRef.current.childElementCount > 0) {
        setGsiReady(true);
        return true;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response?.credential) {
            callbackRef.current?.(response.credential);
          } else {
            onErrorRef.current?.('Google did not return a valid credential.');
          }
        },
      });
      gsiContainerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(gsiContainerRef.current, {
        theme: 'outline',
        size: 'large',
        width: 400,
      });
      renderedClientIdRef.current = clientId;
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
  }, [clientId]);

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
      onErrorRef.current?.(
        clientId
          ? 'Google Sign-In is still loading or blocked by your browser. Please try again.'
          : 'Google Sign-In is not configured on this environment.'
      );
    }
  };

  const isInactive = disabled || loading;

  return (
    <div
      data-testid="google-auth-wrapper"
      className={`relative w-full ${isInactive ? 'cursor-not-allowed' : 'is-interactive'}`}
      onClickCapture={handleWrapperClickCapture}
    >
      <style>{`
        .miljor-google-btn {
          background-color: #ffffff;
          border-color: #d4c7b2;
          color: #0c2b24;
          box-shadow: 0 1px 2px rgba(12, 43, 36, 0.05);
        }
        [data-testid="google-auth-wrapper"].is-interactive:hover .miljor-google-btn {
          background-color: #f6f1e6;
          border-color: #b89452;
          box-shadow: 0 2px 8px rgba(12, 43, 36, 0.08);
        }
        [data-testid="google-auth-wrapper"].is-interactive:active .miljor-google-btn,
        .miljor-google-btn:not(:disabled):active {
          transform: scale(0.985);
        }
        html.dark .miljor-google-btn {
          background-color: #06261e;
          border-color: rgba(200, 178, 118, 0.34);
          color: #f7f3e8;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
        }
        html.dark [data-testid="google-auth-wrapper"].is-interactive:hover .miljor-google-btn {
          background-color: #0d3f32;
          border-color: rgba(223, 191, 133, 0.68);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.36);
        }
        .miljor-google-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px #fcf9f2, 0 0 0 4px #c8b276;
        }
        html.dark .miljor-google-btn:focus-visible {
          box-shadow: 0 0 0 2px #0a3429, 0 0 0 4px #c8b276;
        }
      `}</style>
      <button
        type="button"
        disabled={isInactive}
        aria-label={label}
        onClick={() => {
          if (onBeforeClick && onBeforeClick() === false) return;
          if (window.google?.accounts?.id) {
            window.google.accounts.id.prompt((notification) => {
              if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.() || notification?.isDismissedMoment?.()) {
                onErrorRef.current?.('Google sign-in popup was cancelled or blocked by your browser.');
              }
            });
          }
        }}
        className="miljor-google-btn w-full h-11 px-4 rounded-xl border text-sm font-semibold tracking-[0.01em] flex items-center justify-center gap-2.5 select-none cursor-pointer transition-all duration-150 ease-out disabled:opacity-55 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-[#c8b276]" />
        ) : (
          <GoogleLogo />
        )}
        <span>{loading ? 'Connecting with Google…' : label}</span>
      </button>

      <div
        ref={gsiContainerRef}
        data-testid="google-gsi-container"
        aria-hidden="true"
        className={
          gsiReady && !disabled && !loading
            ? 'absolute inset-0 opacity-[0.001] overflow-hidden flex items-center justify-center cursor-pointer'
            : 'hidden'
        }
      />
    </div>
  );
}
