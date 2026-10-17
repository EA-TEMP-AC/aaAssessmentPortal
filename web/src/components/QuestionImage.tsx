import { useEffect, useState } from "react";
import { fetchQuestionImage } from "../api/questionImages";

/**
 * X-25. One picture of a question. Fetched with the sign-in and shown from a temporary address.
 * The description is the picture's alt text for screen readers. Shows a short message if the
 * picture cannot be loaded, so the question can still be answered.
 */
export function QuestionImage({ imageId, alt }: { imageId: string; alt: string }) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });

  useEffect(() => {
    const controller = new AbortController();
    let created: string | null = null;
    fetchQuestionImage(imageId, controller.signal)
      .then((blob) => {
        created = URL.createObjectURL(blob);
        setState({ url: created, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ url: null, failed: true });
      });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [imageId]);

  if (state.failed) {
    return (
      <p role="status" className="field-hint">
        The picture could not be loaded. Description: {alt}
      </p>
    );
  }
  if (!state.url) {
    return (
      <p role="status" className="field-hint">
        Loading picture…
      </p>
    );
  }
  return <img src={state.url} alt={alt} style={{ maxWidth: "100%", height: "auto" }} />;
}
