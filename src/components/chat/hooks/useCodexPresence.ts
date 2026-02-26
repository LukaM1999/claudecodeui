import { useCallback, useEffect, useRef } from 'react';
import type { ProjectSession, SessionProvider } from '../../../types/app';

const PRESENCE_HEARTBEAT_MS = 20_000;

interface UseCodexPresenceArgs {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  provider: SessionProvider;
  currentSessionId: string | null;
  selectedSession: ProjectSession | null;
}

const buildClientId = () =>
  `codex-client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function useCodexPresence({
  ws,
  sendMessage,
  provider,
  currentSessionId,
  selectedSession,
}: UseCodexPresenceArgs) {
  const clientIdRef = useRef(buildClientId());

  const sendPresence = useCallback(
    (messageType: 'presence:update' | 'presence:heartbeat') => {
      if (provider !== 'codex' || typeof document === 'undefined') {
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const visibility = document.visibilityState === 'visible' ? 'visible' : 'hidden';
      const focused = document.hasFocus();
      const sessionId = currentSessionId || selectedSession?.id || null;

      sendMessage({
        type: messageType,
        provider: 'codex',
        sessionId,
        visibility,
        focused,
        clientId: clientIdRef.current,
        ts: new Date().toISOString(),
      });
    },
    [currentSessionId, provider, selectedSession?.id, sendMessage, ws],
  );

  useEffect(() => {
    if (provider !== 'codex') {
      return;
    }

    sendPresence('presence:update');

    const onVisibilityChange = () => sendPresence('presence:update');
    const onFocus = () => sendPresence('presence:update');
    const onBlur = () => sendPresence('presence:update');

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    const heartbeatTimer = window.setInterval(() => {
      sendPresence('presence:heartbeat');
    }, PRESENCE_HEARTBEAT_MS);

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({
          type: 'presence:update',
          provider: 'codex',
          sessionId: null,
          visibility: 'hidden',
          focused: false,
          clientId: clientIdRef.current,
          ts: new Date().toISOString(),
        });
      }

      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.clearInterval(heartbeatTimer);
    };
  }, [provider, sendMessage, sendPresence, ws]);

  useEffect(() => {
    if (provider !== 'codex') {
      return;
    }
    sendPresence('presence:update');
  }, [provider, currentSessionId, selectedSession?.id, sendPresence]);
}
