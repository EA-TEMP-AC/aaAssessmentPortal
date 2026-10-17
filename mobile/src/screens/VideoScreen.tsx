import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as FileSystem from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { VideoApi, VideoPart, VivaQuestion } from "../api/videoApi";
import type { RosterCandidate } from "../domain/batch";
import type { PendingVideo, VideoQueue } from "../storage/videoQueue";

type Props = {
  batchId: string;
  roster: RosterCandidate[];
  videoApi: VideoApi;
  queue: VideoQueue;
  getAccessToken: () => string;
  newId: () => string;
  deviceId?: string;
};

// One complete video per student and part. 30 minutes at 480p stays under the server's 200 MB limit.
const MAX_SECONDS = 1800;
const MAX_BYTES = 190 * 1024 * 1024;

/**
 * X-40, X-41. Practical and viva recording: one complete video per student and part. The assessor
 * picks the student and the part, records with the back camera, and steps through the questions
 * on screen while recording. The video is saved on the phone first and
 * then uploaded; if there is no network it waits in the list below until Upload is pressed.
 */
export function VideoScreen({ batchId, roster, videoApi, queue, getAccessToken, newId, deviceId }: Props) {
  const students = roster.filter((c) => c.active);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [part, setPart] = useState<VideoPart>("practical");
  const [questions, setQuestions] = useState<VivaQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingVideo[]>([]);
  const [uploading, setUploading] = useState(false);
  const camera = useRef<CameraView>(null);
  // The parent passes a new function each render; keep the latest one without re-running effects.
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const refresh = useCallback(async () => setPending(await queue.list()), [queue]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let live = true;
    videoApi
      .getVivaQuestions(batchId, tokenRef.current())
      .then((items) => live && setQuestions(items))
      .catch(() => live && setMessage("Could not load the questions. Connect once to load them."));
    return () => {
      live = false;
    };
  }, [batchId, videoApi]);

  const shown = questions.filter((q) => q.type === part);
  const student = students.find((c) => c.id === studentId) ?? null;
  const question = shown[Math.min(qIndex, Math.max(shown.length - 1, 0))] ?? null;
  const ready = Boolean(student) && !recording && camPerm?.granted && micPerm?.granted;

  async function uploadOne(item: PendingVideo): Promise<boolean> {
    const result = await videoApi.uploadVideo(item, tokenRef.current());
    if (result.kind === "success" || result.kind === "rejected") {
      if (result.kind === "rejected") setMessage(`Not accepted: ${result.message}`);
      await queue.remove(item.clientEventId);
      await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined);
      return result.kind === "success";
    }
    await queue.markFailed(item.clientEventId, result.message);
    return false;
  }

  async function uploadAll() {
    setUploading(true);
    setMessage(null);
    let done = 0;
    const items = await queue.list();
    for (const item of items) {
      if (await uploadOne(item)) done += 1;
    }
    await refresh();
    setUploading(false);
    setMessage(done === items.length ? "All videos uploaded." : `${done} of ${items.length} uploaded. The rest will wait.`);
  }

  async function start() {
    if (!student || !camera.current) return;
    setMessage(null);
    setQIndex(0);
    setRecording(true);
    const capturedAt = new Date().toISOString();
    try {
      const result = await camera.current.recordAsync({ maxDuration: MAX_SECONDS, maxFileSize: MAX_BYTES });
      setRecording(false);
      if (!result?.uri) throw new Error("No video was saved");
      const dir = `${FileSystem.documentDirectory}videos/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
      const id = newId();
      const uri = `${dir}${id}.mp4`;
      await FileSystem.moveAsync({ from: result.uri, to: uri });
      await queue.add({
        clientEventId: id,
        batchId,
        candidateId: student.id,
        part,
        capturedAt,
        deviceId,
        uri,
        candidateName: student.name,
        label: part === "viva" ? "Viva" : "Practical",
      });
      await refresh();
      setMessage("Saved. Uploading...");
      const item = (await queue.list()).find((i) => i.clientEventId === id);
      if (item && (await uploadOne(item))) setMessage("Uploaded.");
      else setMessage("Saved on the phone. It will upload when you press Upload.");
      await refresh();
    } catch (err) {
      setRecording(false);
      setMessage(err instanceof Error ? err.message : "Recording failed");
    }
  }

  function stop() {
    camera.current?.stopRecording();
  }

  if (!camPerm || !micPerm) return <View style={styles.screen} />;
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Video</Text>
        <Text style={styles.note}>The camera and microphone are needed to record.</Text>
        <Pressable
          style={styles.primary}
          onPress={() => {
            void requestCam();
            void requestMic();
          }}
        >
          <Text style={styles.primaryText}>Allow camera and microphone</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Video</Text>
      <Text style={styles.label}>Part</Text>
      <View style={styles.row}>
        {(["practical", "viva"] as const).map((p) => (
          <Pressable
            key={p}
            disabled={recording}
            style={[styles.chip, part === p && styles.chipOn]}
            onPress={() => {
              setPart(p);
              setQIndex(0);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: part === p }}
          >
            <Text style={[styles.chipText, part === p && styles.chipTextOn]}>
              {p === "viva" ? "Viva" : "Practical"}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Student</Text>
      {students.length === 0 ? <Text style={styles.note}>No students on this batch.</Text> : null}
      <View style={styles.wrap}>
        {students.map((c) => (
          <Pressable
            key={c.id}
            disabled={recording}
            style={[styles.chip, studentId === c.id && styles.chipOn]}
            onPress={() => setStudentId(c.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: studentId === c.id }}
          >
            <Text style={[styles.chipText, studentId === c.id && styles.chipTextOn]}>{c.name}</Text>
          </Pressable>
        ))}
      </View>

      {shown.length === 0 ? (
        <Text style={styles.note}>No {part} questions are set for this batch. You can still record.</Text>
      ) : (
        <Text style={styles.note}>
          {shown.length} {part === "viva" ? "questions" : "tasks"} to cover. They show here while recording.
        </Text>
      )}

      {recording && question ? (
        <View style={styles.askBox}>
          <Text style={[styles.small, { color: "#ccc" }]}>
            {qIndex + 1} of {shown.length} ({question.nosId} / {question.pcId}, {question.marks} marks)
          </Text>
          <Text style={styles.askText}>{question.stem}</Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.chip, qIndex === 0 && styles.disabled]}
              disabled={qIndex === 0}
              onPress={() => setQIndex((i) => Math.max(0, i - 1))}
              accessibilityRole="button"
            >
              <Text style={styles.chipText}>Previous</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, qIndex >= shown.length - 1 && styles.disabled]}
              disabled={qIndex >= shown.length - 1}
              onPress={() => setQIndex((i) => Math.min(shown.length - 1, i + 1))}
              accessibilityRole="button"
            >
              <Text style={styles.chipText}>Next</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.cameraBox}>
        <CameraView ref={camera} style={styles.camera} facing="back" mode="video" videoQuality="480p" />
      </View>

      {recording ? (
        <Pressable style={styles.stop} onPress={stop} accessibilityRole="button">
          <Text style={styles.primaryText}>Stop recording</Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.primary, !ready && styles.disabled]}
          disabled={!ready}
          onPress={() => void start()}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{student ? `Record ${student.name}` : "Pick a student first"}</Text>
        </Pressable>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.label}>Waiting to upload ({pending.length})</Text>
      {pending.map((p) => (
        <View key={p.clientEventId} style={styles.q}>
          <Text style={styles.qText}>{p.candidateName}, {p.label}</Text>
          {p.lastError ? <Text style={styles.small}>Last try failed: {p.lastError}</Text> : null}
        </View>
      ))}
      {pending.length > 0 ? (
        <Pressable style={[styles.primary, uploading && styles.disabled]} disabled={uploading} onPress={() => void uploadAll()}>
          <Text style={styles.primaryText}>{uploading ? "Uploading..." : "Upload"}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, backgroundColor: "#f7f7f5", padding: 24, paddingTop: 64 },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#444", marginTop: 16, marginBottom: 6 },
  note: { fontSize: 14, color: "#666", marginBottom: 8 },
  small: { fontSize: 12, color: "#666", marginTop: 2 },
  row: { flexDirection: "row", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: "#ccc", paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: "#1d4ed8", borderColor: "#1d4ed8" },
  chipText: { fontSize: 14, color: "#222" },
  chipTextOn: { color: "#fff" },
  q: { backgroundColor: "#fff", borderRadius: 8, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: "#e5e5e5" },
  qOn: { borderColor: "#1d4ed8", borderWidth: 2 },
  qText: { fontSize: 15, color: "#222" },
  askBox: { backgroundColor: "#111", borderRadius: 8, padding: 16, marginTop: 12 },
  askText: { color: "#fff", fontSize: 20, lineHeight: 28, marginVertical: 8 },
  cameraBox: { height: 260, borderRadius: 8, overflow: "hidden", marginTop: 16, backgroundColor: "#000" },
  camera: { flex: 1 },
  primary: { backgroundColor: "#1d4ed8", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  stop: { backgroundColor: "#b91c1c", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  message: { fontSize: 14, color: "#222", marginTop: 10 },
});
