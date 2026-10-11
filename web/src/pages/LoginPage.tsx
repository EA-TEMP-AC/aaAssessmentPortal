import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { errorMessage } from "../api/client";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { email: string; password: string }) => login(input.email, input.password),
    onSuccess: (session) => {
      const next = session.user.mustChangePassword ? "/change-password" : "/home";
      navigate(next, { replace: true });
    },
  });

  const message = clientError ?? (mutation.isError ? errorMessage(mutation.error) : null);

  return (
    <main className="auth-card">
      <h1>Sign in</h1>
      <p>Use the email and password for your assessment portal account.</p>
      <form
        noValidate
        aria-busy={mutation.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!email.trim() || !password) {
            setClientError("Enter your email and password.");
            return;
          }
          setClientError(null);
          mutation.mutate({ email: email.trim(), password });
        }}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            required
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "login-error" : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setClientError(null);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            required
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "login-error" : undefined}
            onChange={(event) => {
              setPassword(event.target.value);
              setClientError(null);
            }}
          />
        </div>
        {message ? (
          <p id="login-error" className="form-error" role="alert">
            {message}
          </p>
        ) : null}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
