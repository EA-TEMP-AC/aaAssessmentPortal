import { generateTemporaryPassword, hashPassword } from "../../lib/password.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { User } from "../../models/user.model.js";
import { enqueueEmailSafely } from "../email/email-queue.service.js";

/** Email text for a new student login. The temporary password goes only into the queued mail. */
function loginText(email, temporaryPassword) {
  return [
    "A login was created for you on the assessment portal.",
    `Sign-in email: ${email}`,
    `Temporary password: ${temporaryPassword}`,
    "Sign in with these details. You will be asked to choose a new password.",
  ].join("\n");
}

/**
 * X-35. Creates the student's login when a candidate is added with an email: role `candidate`,
 * linked to the learner, a generated temporary password that must be changed at first sign-in,
 * and the details emailed. The password is never returned, logged or audited.
 * Never throws: the roster row is already saved. Status:
 * `created`, `has_login` (the learner already has one), `email_in_use`, or `failed`.
 */
export async function createCandidateLogin({ learner, email }) {
  try {
    if (await User.exists({ role: "candidate", linkedProfileId: learner._id })) {
      return { status: "has_login", emailQueued: false };
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    let user;
    try {
      user = await User.create({
        email,
        name: learner.name,
        role: "candidate",
        passwordHash,
        active: true,
        mustChangePassword: true,
        linkedProfileId: learner._id,
      });
    } catch (err) {
      if (err?.code === 11000) return { status: "email_in_use", emailQueued: false };
      throw err;
    }
    const queued = await enqueueEmailSafely({
      to: [email],
      subject: "Your assessment portal sign-in details",
      text: loginText(email, temporaryPassword),
      kind: "candidate_login",
      meta: { userId: user._id.toString() },
    });
    return { status: "created", emailQueued: queued.queued };
  } catch (err) {
    console.error("candidate login failed", safeErrorCode(err, "CANDIDATE_LOGIN_FAILED"));
    return { status: "failed", emailQueued: false };
  }
}
