import { SignOutButton } from "../components/AppLayout";

export function PasswordGatePage() {
  return (
    <main className="gate">
      <h1>Password change required</h1>
      <p>
        An administrator must reset your password before you can use the portal. Sign out, then
        sign in again after the reset.
      </p>
      <SignOutButton />
    </main>
  );
}
