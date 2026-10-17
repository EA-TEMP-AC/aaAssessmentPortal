import { generateTemporaryPassword, hashPassword } from "../../lib/password.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { User } from "../../models/user.model.js";
import { revokeAllRefreshTokens } from "../auth/auth.service.js";
import { enqueueEmailSafely } from "../email/email-queue.service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_DOMAIN = "students.local";

/** Email text for a student login. The temporary password goes only into the queued mail. */
function loginText(loginId, temporaryPassword) {
  return [
    "A login was created for you on the assessment portal.",
    `Sign-in id: ${loginId}`,
    `Temporary password: ${temporaryPassword}`,
    "Sign in with these details. You will be asked to choose a new password.",
  ].join("\n");
}

/**
 * The sign-in id of a student with no usable email: the reference number plus the end of the
 * learner id, so it is unique, and it looks like an email because that is how sign-in works.
 */
export function generatedLoginId(learner) {
  const slug =
    String(learner.externalRef ?? "student")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "student";
  return `${slug}-${String(learner._id).slice(-6)}@${LOGIN_DOMAIN}`;
}

function cleanEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

/**
 * X-36. Every student on a batch gets a login: role `candidate`, linked to the learner, a
 * generated temporary password that must be changed at first sign-in. The sign-in id is the
 * student's email when it is valid and free, otherwise a generated id. The temporary password
 * is kept encrypted on the user until the student changes it, so staff can read it from the
 * student list; it is also emailed when a valid email is on file. Never in audit rows or logs.
 * Never throws: the roster row is already saved.
 *
 * Status: `created`, `has_login` (the learner already has one) or `failed`.
 */
export async function createCandidateLogin({ learner, email }) {
  try {
    const existing = await User.findOne({ role: "candidate", linkedProfileId: learner._id })
      .select("_id")
      .lean();
    if (existing) return { status: "has_login", emailQueued: false };

    const wanted = cleanEmail(email);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const make = (loginId) =>
      User.create({
        email: loginId,
        name: learner.name,
        role: "candidate",
        passwordHash,
        initialPassword: temporaryPassword,
        active: true,
        mustChangePassword: true,
        linkedProfileId: learner._id,
      });

    let user = null;
    let usedEmail = false;
    if (wanted) {
      try {
        user = await make(wanted);
        usedEmail = true;
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }
    if (!user) {
      try {
        user = await make(generatedLoginId(learner));
      } catch (err) {
        if (err?.code === 11000) return { status: "has_login", emailQueued: false };
        throw err;
      }
    }

    let emailQueued = false;
    if (usedEmail) {
      const queued = await enqueueEmailSafely({
        to: [wanted],
        subject: "Your assessment portal sign-in details",
        text: loginText(wanted, temporaryPassword),
        kind: "candidate_login",
        meta: { userId: user._id.toString() },
      });
      emailQueued = queued.queued;
    }
    return { status: "created", emailQueued, usedEmail };
  } catch (err) {
    console.error("candidate login failed", safeErrorCode(err, "CANDIDATE_LOGIN_FAILED"));
    return { status: "failed", emailQueued: false };
  }
}

/** A new temporary password for an existing student login, readable from the list until it is changed. */
export async function resetCandidateLogin(learnerId) {
  const user = await User.findOne({ role: "candidate", linkedProfileId: learnerId });
  if (!user) return null;
  const temporaryPassword = generateTemporaryPassword();
  user.passwordHash = await hashPassword(temporaryPassword);
  user.initialPassword = temporaryPassword;
  user.mustChangePassword = true;
  user.active = true;
  await user.save();
  await revokeAllRefreshTokens(user._id);
  return { status: "reset" };
}

/**
 * What staff see next to a student: the sign-in id and, until the student has changed it,
 * the temporary password. Returns a map learnerId -> login, and the user ids whose password was shown.
 */
export async function loginsForLearners(learnerIds) {
  const users = await User.find({
    role: "candidate",
    linkedProfileId: { $in: learnerIds },
  })
    .select("+initialPassword")
    .lean();
  const byLearner = new Map();
  const shown = [];
  for (const user of users) {
    const password = user.initialPassword ?? null;
    if (password) shown.push(String(user._id));
    byLearner.set(String(user.linkedProfileId), {
      loginId: user.email,
      initialPassword: password,
      mustChangePassword: Boolean(user.mustChangePassword),
      active: user.active !== false,
    });
  }
  return { byLearner, shown };
}
