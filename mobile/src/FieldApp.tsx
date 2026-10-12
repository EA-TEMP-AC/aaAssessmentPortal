import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { createAuthApi } from "./api/authApi";
import { createBatchApi } from "./api/batchApi";
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
import type { CachedBatchData } from "./domain/batch";
import type { DeviceInfo } from "./domain/device";
import { expoGpsCapture } from "./geo/expoLocation";
import { recordAuthGeoEvent } from "./geo/recordAuthGeoEvent";
import { netInfoConnectivity } from "./net/netInfoConnectivity";
import { createEventQueue, type QueueSnapshot } from "./queue/eventQueue";
import type { AttendanceRecordInput, ChecklistItemInput } from "./queue/types";
import { AttendanceScreen } from "./screens/AttendanceScreen";
import { BatchScreen } from "./screens/BatchScreen";
import { ChecklistScreen } from "./screens/ChecklistScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { PasswordChangeScreen } from "./screens/PasswordChangeScreen";
import { StatusScreen } from "./screens/StatusScreen";
import { asyncStorageStore } from "./storage/asyncStorageAdapter";
import { createBatchStore } from "./storage/batchStore";
import { secureStore } from "./storage/secureStoreAdapter";
import { syncQueue } from "./sync/syncQueue";

const EMPTY_SNAPSHOT: QueueSnapshot = {
  queueLength: 0,
  pending: 0,
  lastSyncAt: null,
  conflicts: [],
  retryMessage: null,
};

type Tab = "batch" | "attendance" | "checklist" | "status";

function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function FieldApp() {
  const env = useMemo(() => mobileEnvFromProcess(), []);
  const sessions = useMemo(() => createSessionStore(secureStore), []);
  const batchStore = useMemo(() => createBatchStore(asyncStorageStore), []);
  const queue = useMemo(
    () => createEventQueue(asyncStorageStore, { createId: () => Crypto.randomUUID() }),
    [],
  );
  const authApi = useMemo(() => createAuthApi({ baseUrl: env.apiBaseUrl }), [env.apiBaseUrl]);
  const loginEvents = useMemo(
    () => createLoginEventApi({ mode: env.loginEventsMode, baseUrl: env.apiBaseUrl }),
    [env.apiBaseUrl, env.loginEventsMode],
  );
  const batchApi = useMemo(
    () => createBatchApi({ mode: env.loginEventsMode, baseUrl: env.apiBaseUrl }),
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

  // Field workflow state
  const [tab, setTab] = useState<Tab>("batch");
  const [cachedBatch, setCachedBatch] = useState<CachedBatchData | null>(null);
  const [downloadingBatch, setDownloadingBatch] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState(false);

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

  async function loadCachedBatch() {
    const loaded = await batchStore.getBatch();
    setCachedBatch(loaded);
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
        batchApi,
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
        await loadCachedBatch();
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
        await loadCachedBatch();
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
        const batchId = cachedBatch?.batch?.id ?? null;
        if (session && !session.user.mustChangePassword) {
          const device = await currentDevice();
          await recordAuthGeoEvent({
            queue,
            type: "logout",
            role: session.user.role,
            userId: session.user.id,
            batchId,
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

  async function handleDownloadBatch() {
    if (decision.state !== "ready") return;
    setDownloadingBatch(true);
    setBanner(null);
    try {
      await enqueueWork(async () => {
        const batches = await batchApi.listAssignedBatches(decision.session.accessToken);
        if (batches.length === 0) {
          setBanner("No assigned batches found for this assessor.");
          return;
        }
        const assigned = batches[0];
        if (!assigned) {
          setBanner("No assigned batch available.");
          return;
        }
        const roster = await batchApi.getCandidates(assigned.id, decision.session.accessToken);
        const saved = await batchStore.saveBatch(assigned, roster);
        setCachedBatch(saved);

        // Attach the batch id to queued events once the batch is downloaded
        await queue.attachBatchId(assigned.id, decision.session.user.id);
        setNotice(`Downloaded batch #${assigned.id.slice(-6)} and ${roster.length} candidates for offline use.`);
        await refreshSnapshot();
        await syncNow();
      });
    } catch (err) {
      setBanner(messageFrom(err, "Failed to download assigned batch."));
    } finally {
      setDownloadingBatch(false);
    }
  }

  async function handleSaveAttendance(records: AttendanceRecordInput[]) {
    if (decision.state !== "ready" || !cachedBatch?.batch?.id) return;
    setSavingAttendance(true);
    setBanner(null);
    try {
      await enqueueWork(async () => {
        const batchId = cachedBatch.batch.id;
        const capturedAt = new Date().toISOString();
        const updated = await batchStore.saveAttendance(batchId, records, capturedAt);
        setCachedBatch(updated);

        await queue.enqueue({
          type: "attendance",
          userId: decision.session.user.id,
          batchId,
          capturedAt,
          records,
        });

        await refreshSnapshot();
        await syncNow();
      });
    } catch (err) {
      setBanner(messageFrom(err, "Failed to save attendance."));
    } finally {
      setSavingAttendance(false);
    }
  }

  async function handleSaveChecklist(items: ChecklistItemInput[], completeAssessment: boolean) {
    if (decision.state !== "ready" || !cachedBatch?.batch?.id) return;
    setSavingChecklist(true);
    setBanner(null);
    try {
      await enqueueWork(async () => {
        const batchId = cachedBatch.batch.id;
        const capturedAt = new Date().toISOString();
        const updated = await batchStore.saveChecklist(batchId, items, completeAssessment);
        setCachedBatch(updated);

        await queue.enqueue({
          type: "checklist",
          userId: decision.session.user.id,
          batchId,
          capturedAt,
          items,
          completeAssessment,
        });

        await refreshSnapshot();
        await syncNow();
      });
    } catch (err) {
      setBanner(messageFrom(err, "Failed to save checklist."));
    } finally {
      setSavingChecklist(false);
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
    let screenContent;
    if (tab === "batch") {
      screenContent = (
        <BatchScreen
          batchData={cachedBatch}
          online={online}
          downloading={downloadingBatch}
          onDownload={handleDownloadBatch}
          notice={notice}
          banner={banner}
        />
      );
    } else if (tab === "attendance") {
      if (!cachedBatch) {
        screenContent = (
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>No Batch Downloaded</Text>
            <Text style={styles.promptText}>Download your assigned batch first to mark candidate attendance.</Text>
            <Pressable style={styles.tabSwitchButton} onPress={() => setTab("batch")}>
              <Text style={styles.tabSwitchButtonText}>Go to Batch Screen</Text>
            </Pressable>
          </View>
        );
      } else {
        screenContent = (
          <AttendanceScreen
            batchId={cachedBatch.batch.id}
            batchType={cachedBatch.batch.type}
            batchStatus={cachedBatch.batch.status}
            roster={cachedBatch.roster}
            initialAttendance={cachedBatch.attendance}
            onSave={handleSaveAttendance}
            saving={savingAttendance}
            banner={banner}
          />
        );
      }
    } else if (tab === "checklist") {
      if (!cachedBatch) {
        screenContent = (
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>No Batch Downloaded</Text>
            <Text style={styles.promptText}>Download your assigned batch first to complete the equipment checklist.</Text>
            <Pressable style={styles.tabSwitchButton} onPress={() => setTab("batch")}>
              <Text style={styles.tabSwitchButtonText}>Go to Batch Screen</Text>
            </Pressable>
          </View>
        );
      } else {
        screenContent = (
          <ChecklistScreen
            batchId={cachedBatch.batch.id}
            batchStatus={cachedBatch.batch.status}
            roster={cachedBatch.roster}
            attendance={cachedBatch.attendance}
            initialChecklist={cachedBatch.checklist}
            onSaveChecklist={handleSaveChecklist}
            saving={savingChecklist}
            banner={banner}
          />
        );
      }
    } else {
      screenContent = (
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
    }

    body = (
      <View style={styles.mainContainer}>
        <View style={styles.contentArea}>{screenContent}</View>
        {/* Bottom Tab Bar */}
        <View style={styles.tabBar}>
          <Pressable
            style={[styles.tabItem, tab === "batch" && styles.tabActive]}
            onPress={() => setTab("batch")}
            accessibilityRole="tab"
            accessibilityLabel="Batch"
          >
            <Text style={[styles.tabText, tab === "batch" && styles.tabTextActive]}>Batch</Text>
          </Pressable>
          <Pressable
            style={[styles.tabItem, tab === "attendance" && styles.tabActive]}
            onPress={() => setTab("attendance")}
            accessibilityRole="tab"
            accessibilityLabel="Attendance"
          >
            <Text style={[styles.tabText, tab === "attendance" && styles.tabTextActive]}>Attendance</Text>
          </Pressable>
          <Pressable
            style={[styles.tabItem, tab === "checklist" && styles.tabActive]}
            onPress={() => setTab("checklist")}
            accessibilityRole="tab"
            accessibilityLabel="Checklist"
          >
            <Text style={[styles.tabText, tab === "checklist" && styles.tabTextActive]}>Checklist</Text>
          </Pressable>
          <Pressable
            style={[styles.tabItem, tab === "status" && styles.tabActive]}
            onPress={() => setTab("status")}
            accessibilityRole="tab"
            accessibilityLabel="Session"
          >
            <Text style={[styles.tabText, tab === "status" && styles.tabTextActive]}>
              Session {snapshot.queueLength > 0 ? `(${snapshot.queueLength})` : ""}
            </Text>
          </Pressable>
        </View>
      </View>
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
  mainContainer: {
    flex: 1,
    backgroundColor: "#f7f7f5",
  },
  contentArea: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    paddingBottom: Platform.OS === "ios" ? 20 : 8,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#1a73e8",
  },
  tabText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#666",
  },
  tabTextActive: {
    color: "#1a73e8",
    fontWeight: "700",
  },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f7f7f5",
  },
  promptCard: {
    margin: 20,
    marginTop: 64,
    padding: 24,
    backgroundColor: "#fff",
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  promptTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#222",
    marginBottom: 8,
  },
  promptText: {
    fontSize: 13,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  tabSwitchButton: {
    backgroundColor: "#1a73e8",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  tabSwitchButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
