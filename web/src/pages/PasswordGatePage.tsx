import { useNavigate } from "react-router-dom";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { SignOutButton } from "../components/AppLayout";

export function PasswordGatePage() {
  const navigate = useNavigate();

  return (
    <main className="gate">
      <h1>Password change required</h1>
      <p>Choose a new password before you use the portal.</p>
      <ChangePasswordForm
        onSuccess={() => navigate("/home", { replace: true })}
      />
      <p>
        <SignOutButton />
      </p>
    </main>
  );
}
