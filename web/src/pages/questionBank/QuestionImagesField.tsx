import { useId, useState } from "react";
import { errorMessage } from "../../api/client";
import {
  IMAGES_PER_QUESTION,
  imageProblem,
  uploadQuestionImage,
  type QuestionImageRef,
} from "../../api/questionImages";
import { QuestionImage } from "../../components/QuestionImage";

/**
 * X-25. Pictures under the question text: up to three PNG or JPEG files of at most 1 MB. Each
 * needs a description in words, which is read out to people who cannot see the picture.
 */
export function QuestionImagesField({
  images,
  onChange,
  error,
  disabled,
}: {
  images: QuestionImageRef[];
  onChange: (images: QuestionImageRef[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function add(file: File | undefined) {
    if (!file) return;
    const bad = imageProblem(file);
    if (bad) {
      setProblem(bad);
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const imageId = await uploadQuestionImage(file);
      onChange([...images, { imageId, alt: "" }]);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="bare-fieldset" disabled={disabled} aria-describedby={error ? `${ids}-error` : undefined}>
      <legend>Pictures (optional)</legend>
      <p className="field-hint">
        Up to {IMAGES_PER_QUESTION} pictures, PNG or JPEG, 1 MB or less each. They show under the question text.
      </p>
      {images.map((image, index) => (
        <div key={image.imageId} className="field">
          <QuestionImage imageId={image.imageId} alt={image.alt || "Picture without a description yet"} />
          <label htmlFor={`${ids}-alt-${index}`}>Description of picture {index + 1}</label>
          <input
            id={`${ids}-alt-${index}`}
            type="text"
            maxLength={300}
            value={image.alt}
            onChange={(event) =>
              onChange(images.map((item, at) => (at === index ? { ...item, alt: event.target.value } : item)))
            }
          />
          <button
            type="button"
            className="button-quiet"
            onClick={() => onChange(images.filter((_, at) => at !== index))}
          >
            Remove picture {index + 1}
          </button>
        </div>
      ))}
      {images.length < IMAGES_PER_QUESTION ? (
        <div className="field">
          <label htmlFor={`${ids}-file`}>Add a picture</label>
          <input
            id={`${ids}-file`}
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(event) => {
              const input = event.currentTarget;
              void add(input.files?.[0]).finally(() => {
                input.value = "";
              });
            }}
          />
        </div>
      ) : null}
      {busy ? (
        <p role="status" className="field-hint">
          Uploading picture…
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="form-error">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p id={`${ids}-error`} role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
