import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import * as Crypto from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { createAuthApi } from "./api/authApi";
import { ApiError } from "./api/http";
import { createLoginEventApi } from "./api/loginEvents";
import { ensureDeviceId } from "./auth/deviceId";
import {
  createSessionStore,
  decideSession,
  offlineSessionEndsAt,
  sessionFromAuthResponse,
  type SessionDecision,
  type StoredSession,
} from "./auth/session";
import { APP_VERSION } from "./config/compliance";
import { mobileEnvFromProcess } from "./config/env";
import type { DeviceInfo } from "./domain/device";
import { expoGpsCapture } from "./geo/expoLocation";
import { recordAuthGeoEvent } from "./geo/recordAuthGeoEvent";
import { netInfoConnectivity } from "./net/netInfoConnectivity";
import { createEventQueue, type QueueSnapshot } from "./queue/eventQueue";
import { PasswordChangeScreen } from "./screens/PasswordChangeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { StatusScreen } from "./screens/StatusScreen";
import { asyncStorageStore } from "./storage/asyncStorageAdapter";
import { secureStore } from "./storage/secureStoreAdapter";
import { syncQueue } from "./sync/syncQueue";

const EMPTY_SNAPSHOT: QueueSnapshot = {
  queueLength: 0,
  pending: 0,
  lastSyncAt: null,
  conflicts: [],
  retryMessage: null,
};

function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function FieldApp() {
  const env = useMemo(() => mobileEnvFromProcess(), []);
  const sessions = useMemo(() => createSessionStore(secureStore), []);
  const queue = useMemo(
    () => createEventQueue(asyncStorageStore, { createId: () => Crypto.randomUUID() }),
    [],
  );
  const authApi = useMemo(() => createAuthApi({ baseUrl: env.apiBaseUrl }), [env.apiBaseUrl]);
  const loginEvents = useMemo(
    () => createLoginEventApi({ mode: env.loginEventsMode, baseUrl: env.apiBaseUrl }),
    [env.apiBaseUrl, env.loginEventsMode],
  );
  const connectivity = useMemo(() => netInfoConnectivity(), []);
  const capture = useMemo(() => expoGpsCapture(), []);

  const [booting, setBooting] = useState(true);
  const [online, setOnline] = useState(false);
  const [decision, setDecision] = useState<SessionDecision>({ state: "anonymous" });
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY_SNAPSHOT);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const onlineRef = useRef(false);
  const tail = useRef(Promise.resolve());

  function enqueueWork(work: () => Promise<void>): Promise<void> {
    const run = tail.current.then(work, work);
    tail.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function currentDevice(): Promise<DeviceInfo> {
    const deviceId = await ensureDeviceId(secureStore, () => Crypto.randomUUID());
    return { deviceId, platform: Platform.OS, appVersion: APP_VERSION };
  }

  async function refreshSnapshot() {
    setSnapshot(await queue.snapshot());
  }

  async function rotate(current: StoredSession): Promise<StoredSession | null> {
    try {
      const device = await currentDevice();
      const response = await authApi.refresh(current.refreshToken, device);
      const next = sessionFromAuthResponse(response, Date.now());
      await sessions.save(next);
      setDecision(decideSession(next, Date.now(), true));
      setBanner(null);
      return next;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHORIZED")) {
        await sessions.clear();
        setDecision({ state: "anonymous" });
        setNotice("The session was rejected. Sign in again.");
        return null;
      }
      setBanner(messageFrom(err, "Could not refresh the session."));
      return null;
    }
  }

  async function syncNow(): Promise<void> {
    const onlineNow = await connectivity.isOnline();
    onlineRef.current = onlineNow;
    setOnline(onlineNow);

    const loaded = await sessions.load();
    const decisionNow = decideSession(loaded, Date.now(), onlineNow);
    if (decisionNow.state === "offline_expired") {
      await sessions.clear();
      setNotice("Your offline session has ended. Sign in online to continue.");
      setDecision({ state: "anonymous" });
      await refreshSnapshot();
      return;
    }
    setDecision(decisionNow);
    if (decisionNow.state !== "ready" || !onlineNow) {
      await refreshSnapshot();
      return;
    }

    let current = decisionNow.session;
    if (decisionNow.needsRefresh) {
      const rotated = await rotate(current);
      if (!rotated) {
        await refreshSnapshot();
        return;
      }
      current = rotated;
    }

    const run = (token: string) =>
      syncQueue({
        queue,
        api: loginEvents,
        accessToken: token,
        userId: current.user.id,
        online: true,
        now: () => Date.now(),
      });

    let report = await run(current.accessToken);
    if (report.stopped === "unauthorized") {
      const rotated = await rotate(current);
      if (!rotated) {
        await refreshSnapshot();
        return;
      }
      current = rotated;
      report = await run(current.accessToken);
      if (report.stopped === "unauthorized") {
        await sessions.clear();
        setDecision({ state: "anonymous" });
        setNotice("The session was rejected. Sign in again.");
      }
    }
    await refreshSnapshot();
  }

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let active = true;

    async function boot() {
      try {
        const onlineNow = await connectivity.isOnline();
        if (!active) return;
        onlineRef.current = onlineNow;
        setOnline(onlineNow);
        await syncNow();
      } catch (err) {
        if (active) setBanner(messageFrom(err, "Could not restore the session."));
      } finally {
        if (active) setBooting(false);
      }
      if (!active) return;
      const stop = connectivity.subscribe((next) => {
        onlineRef.current = next;
        setOnline(next);
        if (next) {
          void enqueueWork(async () => {
            try {
              await syncNow();
            } catch (err) {
              setBanner(messageFrom(err, "Sync failed."));
            }
          });
        }
      });
      let listening = true;
      const stopListening = () => {
        if (!listening) return;
        listening = false;
        stop();
      };
      unsubscribe = stopListening;
      if (!active) {
        stopListening();
        return;
      }
      timer = setInterval(() => {
        void enqueueWork(async () => {
          try {
            await syncNow();
          } catch (err) {
            setBanner(messageFrom(err, "Sync failed."));
          }
        });
      }, 15_000);
    }

    void boot();
    return () => {
      active = false;
      unsubscribe?.();
      unsubscribe = undefined;
      if (timer) clearInterval(timer);
    };
  }, [authApi, capture, connectivity, env.apiBaseUrl, env.loginEventsMode, loginEvents, queue, sessions]);

  async function onLogin(email: string, password: string) {
    setError(null);
    setNotice(null);
    if (!email || !password) {
      setError("Enter an email and password.");
      return;
    }
    setSubmitting(true);
    try {
      await enqueueWork(async () => {
        const onlineNow = await connectivity.isOnline();
        onlineRef.current = onlineNow;
        setOnline(onlineNow);
        if (!onlineNow) {
          setError("You are offline. Connect to the network to sign in.");
          return;
        }
        const device = await currentDevice();
        const response = await authApi.login(email, password, device);
        const session = sessionFromAuthResponse(response, Date.now());
        await sessions.save(session);
        if (!session.user.mustChangePassword) {
          await recordAuthGeoEvent({
            queue,
            type: "login",
            role: session.user.role,
            userId: session.user.id,
            batchId: null,
            device,
            capture,
            now: () => Date.now(),
          });
        }
        setDecision(decideSession(session, Date.now(), true));
        await syncNow();
      });
    } catch (err) {
      setError(messageFrom(err, "Sign-in failed."));
    } finally {
      setSubmitting(false);
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    try {
      await enqueueWork(async () => {
        const session = await sessions.load();
        if (session && !session.user.mustChangePassword) {
          const device = await currentDevice();
          await recordAuthGeoEvent({
            queue,
            type: "logout",
            role: session.user.role,
            userId: session.user.id,
            batchId: null,
            device,
            capture,
            now: () => Date.now(),
          });
          if (onlineRef.current) {
            await syncNow();
            const latest = await sessions.load();
            if (latest) {
              try {
                await authApi.logout(latest.refreshToken);
              } catch {
                // The logout geo event stays queued when the auth call fails.
              }
            }
          }
        } else if (session && onlineRef.current) {
          try {
            await authApi.logout(session.refreshToken);
          } catch {
            // Local sign-out still clears the session.
          }
        }
        await sessions.clear();
        setDecision({ state: "anonymous" });
        setBanner(null);
        setError(null);
        await refreshSnapshot();
      });
    } finally {
      setLoggingOut(false);
    }
  }

  const offlineUntilLabel =
    !online && decision.state === "ready"
      ? new Date(offlineSessionEndsAt(decision.session)).toLocaleString()
      : null;

  let body;
  if (booting) {
    body = (
      <View style={styles.boot}>
        <ActivityIndicator />
      </View>
    );
  } else if (decision.state === "password_change_required") {
    body = <PasswordChangeScreen onSignOut={() => void onLogout()} signingOut={loggingOut} />;
  } else if (decision.state === "ready") {
    body = (
      <StatusScreen
        userName={decision.session.user.name}
        online={online}
        snapshot={snapshot}
        loginEventsMode={env.loginEventsMode}
        offlineUntilLabel={offlineUntilLabel}
        banner={banner}
        loggingOut={loggingOut}
        onLogout={() => void onLogout()}
      />
    );
  } else {
    body = (
      <LoginScreen
        online={online}
        notice={notice ?? banner}
        error={error}
        submitting={submitting}
        onSubmit={(email, password) => void onLogin(email, password)}
      />
    );
  }

  return (
    <View style={styles.root}>
      {body}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f7f7f5",
  },
});
