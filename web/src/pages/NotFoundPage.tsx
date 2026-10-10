import { Link } from "react-router-dom";
import { useSession } from "../api/session";

export function NotFoundPage() {
  const session = useSession();
  const destination = !session
    ? { to: "/login", label: "Go to sign in" }
    : session.user.mustChangePassword
      ? { to: "/change-password", label: "Back to password change" }
      : { to: "/home", label: "Go to home" };

  return (
    <main className="not-found">
      <h1>Page not found</h1>
      <p>That address is not part of this portal.</p>
      <Link to={destination.to}>{destination.label}</Link>
    </main>
  );
}
