import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { fetchSessionVideoTrack, getSessionVideo } from "../../api/proctoring";

const TRACK_LABELS = { camera: "Camera", screen: "Shared screen" } as const;

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TrackPlayer({ sessionId, track }: { sessionId: string; track: "camera" | "screen" }) {
  const [state, setState] = useState<{ url: string | null; busy: boolean; error: string | null }>({
    url: null,
    busy: false,
    error: null,
  });
  useEffect(() => () => {
    if (state.url) URL.revokeObjectURL(state.url);
  }, [state.url]);

  async function load() {
    setState({ url: null, busy: true, error: null });
    try {
      const blob = await fetchSessionVideoTrack(sessionId, track);
      setState({ url: URL.createObjectURL(blob), busy: false, error: null });
    } catch (err) {
      setState({ url: null, busy: false, error: errorMessage(err) });
    }
  }

  return (
    <div>
      {state.url ? (
        <video controls src={state.url} style={{ maxWidth: "100%" }} aria-label={`${TRACK_LABELS[track]} recording`} />
      ) : (
        <button type="button" onClick={() => void load()} disabled={state.busy}>
          {state.busy ? "Loading…" : `Load ${TRACK_LABELS[track].toLowerCase()} video`}
        </button>
      )}
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
export function SessionVideoPanel({ sessionId }: { sessionId: string }) {
  const query = useQuery({
    queryKey: ["session-video", sessionId],
    queryFn: ({ signal }) => getSessionVideo(sessionId, signal),
    retry: false,
  });
  if (query.isPending) return <p role="status">Checking for exam video…</p>;
  if (query.isError) {
    // Not allowed to watch: say nothing is shown, rather than an error.
    if (query.error instanceof ApiError && query.error.status === 403) return null;
    return (
      <p role="status" className="field-hint">
        The exam video could not be checked. {errorMessage(query.error)}
      </p>
    );
  }
  const video = query.data;
  if (!video.recordVideo) return null;
  const tracks = (["camera", "screen"] as const).filter((t) => video.tracks[t].pieces > 0);
  return (
    <section aria-labelledby="proctor-video-heading">
      <h3 id="proctor-video-heading">Exam video</h3>
      <p className="field-hint">
        Every look is recorded in the access log. The recording is deleted {video.retentionDays} days after it was
        received.
      </p>
      {tracks.length === 0 ? <p>No video has arrived for this session.</p> : null}
      {tracks.map((track) => (
        <div key={track}>
          <h4>{TRACK_LABELS[track]}</h4>
          <p className="field-hint">
            {video.tracks[track].pieces} pieces, {megabytes(video.tracks[track].bytes)}
            {video.tracks[track].complete ? "" : ". Some pieces never arrived, so the video skips there."}
          </p>
          <TrackPlayer sessionId={sessionId} track={track} />
        </div>
      ))}
    </section>
  );
}
