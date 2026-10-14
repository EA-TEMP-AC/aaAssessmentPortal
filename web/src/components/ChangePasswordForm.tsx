import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { changePassword } from "../api/auth";
import { ApiError, errorMessage } from "../api/client";

const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

type FieldErrors = { current?: string; next?: string; confirm?: string };

function hasDetail(error: unknown, key: string): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  const details = error.details;
  return typeof details === "object" && details !== null && key in details;
}

function serverMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Too many attempts. Wait a few minutes, then try again.";
  }
  return errorMessage(error);
}

type Props = {
  onSuccess: () => void;
};

export function ChangePasswordForm({ onSuccess }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: (input: { current: string; next: string }) =>
      changePassword(input.current, input.next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      onSuccess();
    },
  });

  const wrongCurrent =
    mutation.isError && hasDetail(mutation.error, "currentPassword");
  const sameAsCurrent =
    mutation.isError && hasDetail(mutation.error, "newPassword");
  const generalError =
    mutation.isError && !wrongCurrent && !sameAsCurrent
      ? serverMessage(mutation.error)
      : null;

  const currentError =
    errors.current ??
    (wrongCurrent ? "The current password is not correct." : undefined);
  const nextError =
    errors.next ??
    (sameAsCurrent
      ? "The new password must be different from the current password."
      : undefined);

  return (
    <form
      noValidate
      aria-busy={mutation.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        const found: FieldErrors = {};
        if (!current) found.current = "Enter your current password.";
        if (next.length < MIN_LENGTH || next.length > MAX_LENGTH) {
          found.next = `The new password must be ${MIN_LENGTH} to ${MAX_LENGTH} characters.`;
        } else if (next === current) {
          found.next =
            "The new password must be different from the current password.";
        }
        if (confirm !== next)
          found.confirm = "The two new passwords do not match.";
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        mutation.mutate({ current, next });
      }}
    >
      <div className="field">
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          value={current}
          aria-invalid={currentError ? true : undefined}
          aria-describedby={currentError ? "current-password-error" : undefined}
          onChange={(event) => {
            setCurrent(event.target.value);
            setErrors((e) => ({ ...e, current: undefined }));
            if (mutation.isError) mutation.reset();
          }}
        />
        {currentError ? (
          <p id="current-password-error" className="form-error" role="alert">
            {currentError}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          value={next}
          aria-invalid={nextError ? true : undefined}
          aria-describedby={
            nextError ? "new-password-error" : "new-password-hint"
          }
          onChange={(event) => {
            setNext(event.target.value);
            setErrors((e) => ({ ...e, next: undefined }));
            if (mutation.isError) mutation.reset();
          }}
        />
        <p id="new-password-hint" className="field-hint">
          {MIN_LENGTH} to {MAX_LENGTH} characters.
        </p>
        {nextError ? (
          <p id="new-password-error" className="form-error" role="alert">
            {nextError}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirm}
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby={
            errors.confirm ? "confirm-password-error" : undefined
          }
          onChange={(event) => {
            setConfirm(event.target.value);
            setErrors((e) => ({ ...e, confirm: undefined }));
          }}
        />
        {errors.confirm ? (
          <p id="confirm-password-error" className="form-error" role="alert">
            {errors.confirm}
          </p>
        ) : null}
      </div>
      {generalError ? (
        <p className="form-error" role="alert">
          {generalError}
        </p>
      ) : null}
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
