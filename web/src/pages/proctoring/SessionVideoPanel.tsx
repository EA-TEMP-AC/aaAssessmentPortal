import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { fetchSessionVideoTrack, getSessionVideo } from "../../api/proctoring";

const TRACK_LABELS = { camera: "Camera", screen: "Shared screen" } as const;

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Seconds into the recording to start before a flag, so the cause is visible. */
const LEAD_SECONDS = 5;

type Jump = { seconds: number; n: number };

function TrackPlayer({
  sessionId,
  track,
  canDownload,
  jump,
}: {
  sessionId: string;
  track: "camera" | "screen";
  canDownload: boolean;
  jump: Jump | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (jump && videoRef.current) videoRef.current.currentTime = jump.seconds;
  }, [jump]);
  const [state, setState] = useState<{
    url: string | null;
    busy: boolean;
    error: string | null;
  }>({
    url: null,
    busy: false,
    error: null,
  });
  useEffect(
    () => () => {
      if (state.url) URL.revokeObjectURL(state.url);
    },
    [state.url],
  );

  async function load() {
    setState({ url: null, busy: true, error: null });
    try {
      const blob = await fetchSessionVideoTrack(sessionId, track);
      setState({ url: URL.createObjectURL(blob), busy: false, error: null });
    } catch (err) {
      setState({ url: null, busy: false, error: errorMessage(err) });
    }
  }

  async function save() {
    setState((prev) => ({ ...prev, error: null }));
    try {
      const blob = await fetchSessionVideoTrack(
        sessionId,
        track,
        undefined,
        true,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `exam-${sessionId}-${track}.webm`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setState((prev) => ({ ...prev, error: errorMessage(err) }));
    }
  }

  return (
    <div>
      {state.url ? (
        <video
          ref={videoRef}
          controls
          src={state.url}
          style={{ maxWidth: "100%" }}
          aria-label={`${TRACK_LABELS[track]} recording`}
          onLoadedMetadata={(event) => {
            if (jump) event.currentTarget.currentTime = jump.seconds;
          }}
        />
      ) : (
        <button type="button" onClick={() => void load()} disabled={state.busy}>
          {state.busy
            ? "Loading…"
            : `Load ${TRACK_LABELS[track].toLowerCase()} video`}
        </button>
      )}
      {canDownload ? (
        <button type="button" onClick={() => void save()}>
          Download {TRACK_LABELS[track].toLowerCase()} video
        </button>
      ) : null}
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * X-27. The recorded exam video of a session: camera and shared screen. Shown only when the
 * batch records video and the signed-in role may watch it. A video is loaded only when asked
 * for, because each look is written to the access log.
 */
export function SessionVideoPanel({
  sessionId,
  flags = [],
}: {
  sessionId: string;
  /** The session's flags, for jumping to their moment when the batch keeps video as flag evidence. */
  flags?: { id: string; type: string; capturedAt: string }[];
}) {
  const [jump, setJump] = useState<Jump | null>(null);
  const query = useQuery({
    queryKey: ["session-video", sessionId],
    queryFn: ({ signal }) => getSessionVideo(sessionId, signal),
    retry: false,
  });
  if (query.isPending) return <p role="status">Checking for exam video…</p>;
  if (query.isError) {
    // Not allowed to watch: say nothing is shown, rather than an error.
    if (query.error instanceof ApiError && query.error.status === 403)
      return null;
    return (
      <p role="status" className="field-hint">
        The exam video could not be checked. {errorMessage(query.error)}
      </p>
    );
  }
  const video = query.data;
  if (!video.recordVideo) return null;
  const tracks = (["camera", "screen"] as const).filter(
    (t) => video.tracks[t].pieces > 0,
  );
  return (
    <section aria-labelledby="proctor-video-heading">
      <h3 id="proctor-video-heading">Exam video</h3>
      <p className="field-hint">
        Every look is recorded in the access log. The recording is deleted{" "}
        {video.retentionDays} days after it was received.
      </p>
      {tracks.length === 0 ? (
        <p>No video has arrived for this session.</p>
      ) : null}
      {video.flagEvidence === "video" &&
      video.startedAt &&
      flags.length > 0 &&
      tracks.length > 0 ? (
        <div className="field">
          <label htmlFor="video-jump">Go to the moment of a flag</label>
          <select
            id="video-jump"
            defaultValue=""
            onChange={(event) => {
              const flag = flags.find((f) => f.id === event.target.value);
              if (!flag || !video.startedAt) return;
              const seconds =
                (new Date(flag.capturedAt).getTime() -
                  new Date(video.startedAt).getTime()) /
                  1000 -
                LEAD_SECONDS;
              setJump((prev) => ({
                seconds: Math.max(0, seconds),
                n: (prev?.n ?? 0) + 1,
              }));
            }}
          >
            <option value="">Choose a flag</option>
            {flags.map((flag) => (
              <option key={flag.id} value={flag.id}>
                {flag.type.replaceAll("_", " ")} at{" "}
                {new Date(flag.capturedAt).toLocaleTimeString()}
              </option>
            ))}
          </select>
          <p className="field-hint">
            The jump is about right, not exact: it starts {LEAD_SECONDS} seconds
            before the flag.
          </p>
        </div>
      ) : null}
      {tracks.map((track) => (
        <div key={track}>
          <h4>{TRACK_LABELS[track]}</h4>
          <p className="field-hint">
            {video.tracks[track].pieces} pieces,{" "}
            {megabytes(video.tracks[track].bytes)}
            {video.tracks[track].complete
              ? ""
              : ". Some pieces never arrived, so the video skips there."}
          </p>
          <TrackPlayer
            sessionId={sessionId}
            track={track}
            canDownload={video.canDownload}
            jump={jump}
          />
        </div>
      ))}
    </section>
  );
}
