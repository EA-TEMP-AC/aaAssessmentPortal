import { useState } from "react";
import { ChangePasswordForm } from "../components/ChangePasswordForm";

export function ChangePasswordPage() {
  const [done, setDone] = useState(false);

  return (
    <section aria-labelledby="change-password-title" className="gate">
      <h1 id="change-password-title">Change password</h1>
      {done ? (
        <p role="status">
          Your password was changed. Other devices must sign in again.
        </p>
      ) : null}
      <ChangePasswordForm onSuccess={() => setDone(true)} />
    </section>
  );
}
