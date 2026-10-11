import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createUser,
  isUserPageSize,
  listUsers,
  resetUserPassword,
  updateUser,
  USER_PAGE_SIZE_DEFAULT,
  USER_PAGE_SIZE_OPTIONS,
  type CreateUserInput,
  type UserListPage,
  type UserPageSize,
  type UserRecord,
} from "../api/users";
import { errorMessage } from "../api/client";
import { useSession } from "../api/session";
import { ROLE_LABELS, ROLES, type Role } from "../routing/access";
import { canManageUser, rolesAssignableBy } from "./userAccess";

const COLUMNS = ["Name", "Email", "Role", "Status", "Password change", "Actions"] as const;
const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_ORDER = ["email", "name", "role", "password", "confirm", "linkedProfileId", "abId", "tpId"] as const;

type Banner = { id: number; message: string };

type Filters = {
  role: Role | "";
  active: "" | "true" | "false";
  pageSize: UserPageSize;
};

type DialogState =
  | { type: "create" }
  | { type: "edit"; user: UserRecord }
  | { type: "active"; user: UserRecord; nextActive: boolean }
  | { type: "reset"; user: UserRecord };

type FormError = { id: number; message: string; fields: string[] };

const EMPTY_FILTERS: Filters = {
  role: "",
  active: "",
  pageSize: USER_PAGE_SIZE_DEFAULT,
};

function pageCount(total: number, pageSize: number): number {
  if (pageSize < 1) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

function summary(data: UserListPage): string {
  const pages = pageCount(data.total, data.pageSize);
  const noun = data.total === 1 ? "user" : "users";
  return `Page ${data.page} of ${pages}. ${data.pageSize} per page. ${data.total} ${noun}.`;
}

function filtersAreActive(filters: Filters): boolean {
  return Boolean(filters.role || filters.active);
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.hasAttribute("disabled"));
}

function Dialog({
  title,
  busy = false,
  initialFocus = "first",
  onCancel,
  children,
}: {
  title: string;
  busy?: boolean;
  initialFocus?: "first" | "cancel";
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    if (initialFocus === "cancel") {
      root.querySelector<HTMLElement>("[data-dialog-cancel]")?.focus();
      return;
    }
    const first = focusableElements(root)[0];
    (first ?? titleRef.current)?.focus();
  }, [initialFocus]);

  useEffect(() => {
    if (busy) titleRef.current?.focus();
  }, [busy]);

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className="dialog-panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!busy) onCancel();
            return;
          }
          if (event.key !== "Tab" || !dialogRef.current) return;
          const items = focusableElements(dialogRef.current);
          if (items.length === 0) {
            event.preventDefault();
            return;
          }
          const first = items[0];
          const last = items[items.length - 1];
          const index = items.indexOf(document.activeElement as HTMLElement);
          if (event.shiftKey) {
            if (index <= 0) {
              event.preventDefault();
              last?.focus();
            }
          } else if (index === -1 || index === items.length - 1) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function FormAlert({ error }: { error: FormError | null }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!error || error.fields.length > 0) return;
    ref.current?.focus();
  }, [error]);

  if (!error) return null;
  return (
    <p ref={ref} tabIndex={-1} className="form-error" role="alert">
      {error.message}
    </p>
  );
}

function useFormErrorFocus(error: FormError | null, fields: { current: Partial<Record<string, HTMLElement | null>> }) {
  useEffect(() => {
    if (!error || error.fields.length === 0) return;
    const first = FIELD_ORDER.find((key) => error.fields.includes(key));
    const node = first ? fields.current[first] : null;
    node?.focus();
  }, [error, fields]);
}

function optionalId(value: string, label: string, field: string, messages: string[], fields: string[]): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!OBJECT_ID.test(trimmed)) {
    messages.push(`${label} must be a 24-character id, or blank.`);
    fields.push(field);
    return null;
  }
  return trimmed;
}

function UserForm({
  actor,
  user,
  onCancel,
  onSaved,
}: {
  actor: Role;
  user: UserRecord | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const assignable = rolesAssignableBy(actor);
  const editing = user !== null;
  const [draft, setDraft] = useState({
    email: user?.email ?? "",
    name: user?.name ?? "",
    role: (user?.role ?? "") as Role | "",
    active: user?.active ?? true,
    linkedProfileId: user?.linkedProfileId ?? "",
    abId: user?.abId ?? "",
    tpId: user?.tpId ?? "",
  });
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const emailId = useId();
  const nameId = useId();
  const roleId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const activeId = useId();
  const linkedId = useId();
  const abId = useId();
  const tpId = useId();
  const activeHintId = useId();
  const linkedHintId = useId();
  const abHintId = useId();
  const tpHintId = useId();
  const passwordHintId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFormErrorFocus(formError, fieldRefs);

  function bind(key: string) {
    return (node: HTMLInputElement | HTMLSelectElement | null) => {
      fieldRefs.current[key] = node;
    };
  }

  function showError(message: string, fields: string[]) {
    setFormError({ id: ++errorSeq.current, message, fields });
  }

  function updateDraft<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  const idHint = editing ? "24-character id. Leave blank to clear." : "Optional. 24-character id.";

  return (
    <Dialog title={user ? `Edit ${user.name}` : "Create user"} busy={pending} onCancel={onCancel}>
      <form
        noValidate
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const messages: string[] = [];
          const fields: string[] = [];
          const email = draft.email.trim();
          const name = draft.name.trim();
          if (!email) {
            messages.push("Enter an email address.");
            fields.push("email");
          } else if (email.length > 320 || !EMAIL.test(email)) {
            messages.push("Enter a valid email address.");
            fields.push("email");
          }
          if (!name) {
            messages.push("Enter a name.");
            fields.push("name");
          } else if (name.length > 200) {
            messages.push("Name must be 200 characters or fewer.");
            fields.push("name");
          }
          if (!draft.role || !assignable.some((role) => role === draft.role)) {
            messages.push("Select a role.");
            fields.push("role");
          }
          const passwordNode = fieldRefs.current.password;
          const confirmNode = fieldRefs.current.confirm;
          const password = passwordNode instanceof HTMLInputElement ? passwordNode.value : "";
          const confirm = confirmNode instanceof HTMLInputElement ? confirmNode.value : "";
          if (!editing) {
            if (password.length < 8 || password.length > 200) {
              messages.push("Enter a password of 8 to 200 characters.");
              fields.push("password");
            } else if (password !== confirm) {
              messages.push("The passwords do not match.");
              fields.push("confirm");
            }
          }
          const linkedProfileId = optionalId(draft.linkedProfileId, "Linked profile id", "linkedProfileId", messages, fields);
          const awardingBodyId = optionalId(draft.abId, "Awarding body id", "abId", messages, fields);
          const trainingPartnerId = optionalId(draft.tpId, "Training partner id", "tpId", messages, fields);
          if (messages.length > 0 || !draft.role) {
            showError(messages.join(" "), fields);
            return;
          }

          const role = draft.role;
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved = user
                ? await updateUser(user.id, {
                    email,
                    name,
                    role,
                    active: draft.active,
                    linkedProfileId,
                    abId: awardingBodyId,
                    tpId: trainingPartnerId,
                  })
                : await createUser({
                    email,
                    name,
                    role,
                    password,
                    active: draft.active,
                    ...(linkedProfileId ? { linkedProfileId } : {}),
                    ...(awardingBodyId ? { abId: awardingBodyId } : {}),
                    ...(trainingPartnerId ? { tpId: trainingPartnerId } : {}),
                  } satisfies CreateUserInput);
              await queryClient.invalidateQueries({ queryKey: ["users"] });
              if (!mounted.current) return;
              if (passwordNode instanceof HTMLInputElement) passwordNode.value = "";
              if (confirmNode instanceof HTMLInputElement) confirmNode.value = "";
              onSaved(
                user
                  ? `Changes for ${saved.name} were saved.`
                  : `${saved.name} was created. They must change the password the next time they sign in.`,
              );
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              showError(errorMessage(error), []);
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} />
          <div className="field">
            <label htmlFor={emailId}>Email</label>
            <input
              id={emailId}
              ref={bind("email")}
              name="email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              value={draft.email}
              aria-required="true"
              aria-invalid={formError?.fields.includes("email") || undefined}
              onChange={(event) => updateDraft("email", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={nameId}>Name</label>
            <input
              id={nameId}
              ref={bind("name")}
              name="name"
              type="text"
              autoComplete="off"
              value={draft.name}
              aria-required="true"
              aria-invalid={formError?.fields.includes("name") || undefined}
              onChange={(event) => updateDraft("name", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={roleId}>Role</label>
            <select
              id={roleId}
              ref={bind("role")}
              name="role"
              value={draft.role}
              aria-required="true"
              aria-invalid={formError?.fields.includes("role") || undefined}
              onChange={(event) => updateDraft("role", event.target.value as Role | "")}
            >
              <option value="">Select a role</option>
              {assignable.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          {editing ? null : (
            <>
              <div className="field">
                <label htmlFor={passwordId}>Password</label>
                <input
                  id={passwordId}
                  ref={bind("password")}
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  aria-required="true"
                  aria-invalid={formError?.fields.includes("password") || undefined}
                  aria-describedby={passwordHintId}
                  onChange={() => setFormError(null)}
                />
                <p id={passwordHintId} className="field-hint">
                  8 to 200 characters. It is not shown again after you close this form. The user must change it the next
                  time they sign in.
                </p>
              </div>
              <div className="field">
                <label htmlFor={confirmId}>Confirm password</label>
                <input
                  id={confirmId}
                  ref={bind("confirm")}
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  aria-required="true"
                  aria-invalid={formError?.fields.includes("confirm") || undefined}
                  onChange={() => setFormError(null)}
                />
              </div>
            </>
          )}
          <div className="field">
            <label className="check-label" htmlFor={activeId}>
              <input
                id={activeId}
                name="active"
                type="checkbox"
                checked={draft.active}
                aria-describedby={activeHintId}
                onChange={(event) => updateDraft("active", event.target.checked)}
              />
              Active
            </label>
            <p id={activeHintId} className="field-hint">
              Inactive users cannot sign in.
            </p>
          </div>
          <div className="field">
            <label htmlFor={linkedId}>Linked profile id</label>
            <input
              id={linkedId}
              ref={bind("linkedProfileId")}
              name="linkedProfileId"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={draft.linkedProfileId}
              aria-invalid={formError?.fields.includes("linkedProfileId") || undefined}
              aria-describedby={linkedHintId}
              onChange={(event) => updateDraft("linkedProfileId", event.target.value)}
            />
            <p id={linkedHintId} className="field-hint">
              {idHint}
            </p>
          </div>
          <div className="field">
            <label htmlFor={abId}>Awarding body id</label>
            <input
              id={abId}
              ref={bind("abId")}
              name="abId"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={draft.abId}
              aria-invalid={formError?.fields.includes("abId") || undefined}
              aria-describedby={abHintId}
              onChange={(event) => updateDraft("abId", event.target.value)}
            />
            <p id={abHintId} className="field-hint">
              {idHint}
            </p>
          </div>
          <div className="field">
            <label htmlFor={tpId}>Training partner id</label>
            <input
              id={tpId}
              ref={bind("tpId")}
              name="tpId"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={draft.tpId}
              aria-invalid={formError?.fields.includes("tpId") || undefined}
              aria-describedby={tpHintId}
              onChange={(event) => updateDraft("tpId", event.target.value)}
            />
            <p id={tpHintId} className="field-hint">
              {idHint}
            </p>
          </div>
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">{editing ? "Save changes" : "Create user"}</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

function ActiveConfirm({
  user,
  nextActive,
  onCancel,
  onSaved,
}: {
  user: UserRecord;
  nextActive: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const verb = nextActive ? "Activate" : "Deactivate";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <Dialog title={`${verb} ${user.name}?`} busy={pending} initialFocus="cancel" onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved = await updateUser(user.id, { active: nextActive });
              await queryClient.invalidateQueries({ queryKey: ["users"] });
              if (!mounted.current) return;
              onSaved(`${saved.name} is now ${saved.active ? "active" : "inactive"}.`);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              setFormError({ id: ++errorSeq.current, message: errorMessage(error), fields: [] });
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <p>{nextActive ? "They will be able to sign in." : "They will not be able to sign in."}</p>
          <FormAlert error={formError} />
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">{verb}</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

function PasswordResetDialog({
  user,
  onCancel,
  onSaved,
  onProblem,
}: {
  user: UserRecord;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onProblem: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"" | "set" | "email">("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const passwordId = useId();
  const confirmId = useId();
  const passwordHintId = useId();
  const modeHintId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFormErrorFocus(formError, fieldRefs);

  const submitLabel = mode === "email" ? "Queue reset email" : mode === "set" ? "Set password" : "Reset password";

  return (
    <Dialog title={`Reset password for ${user.name}`} busy={pending} onCancel={onCancel}>
      <form
        noValidate
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const passwordNode = fieldRefs.current.password;
          const confirmNode = fieldRefs.current.confirm;
          const password = passwordNode instanceof HTMLInputElement ? passwordNode.value : "";
          const confirm = confirmNode instanceof HTMLInputElement ? confirmNode.value : "";
          if (mode === "") {
            setFormError({ id: ++errorSeq.current, message: "Choose how to reset the password.", fields: [] });
            return;
          }
          if (mode === "set" && (password.length < 8 || password.length > 200)) {
            setFormError({
              id: ++errorSeq.current,
              message: "Enter a password of 8 to 200 characters.",
              fields: ["password"],
            });
            return;
          }
          if (mode === "set" && password !== confirm) {
            setFormError({
              id: ++errorSeq.current,
              message: "The passwords do not match.",
              fields: ["confirm"],
            });
            return;
          }

          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const result =
                mode === "email"
                  ? await resetUserPassword(user.id, { sendEmail: true })
                  : await resetUserPassword(user.id, { newPassword: password });
              await queryClient.invalidateQueries({ queryKey: ["users"] });
              if (!mounted.current) return;
              if (passwordNode instanceof HTMLInputElement) passwordNode.value = "";
              if (confirmNode instanceof HTMLInputElement) confirmNode.value = "";
              if (result.kind === "email" && !result.emailQueued) {
                onProblem(
                  `The password for ${user.name} was changed, but the reset email was not queued. It may not arrive. The temporary password is not shown. You can try sending it again.`,
                );
                return;
              }
              onSaved(
                result.kind === "email"
                  ? `A reset email for ${user.name} was queued for ${user.email}. It may arrive later. The temporary password is not shown. The user must change it the next time they sign in.`
                  : `A new password was set for ${user.name}. It is not shown again. The user must change it the next time they sign in.`,
              );
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              setFormError({ id: ++errorSeq.current, message: errorMessage(error), fields: [] });
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} />
          <fieldset>
            <legend>How should the password be reset?</legend>
            <label className="check-label">
              <input
                type="radio"
                name="resetMode"
                value="set"
                checked={mode === "set"}
                onChange={() => {
                  setMode("set");
                  setFormError(null);
                }}
              />
              Set a new password
            </label>
            <label className="check-label">
              <input
                type="radio"
                name="resetMode"
                value="email"
                checked={mode === "email"}
                onChange={() => {
                  setMode("email");
                  setFormError(null);
                  const passwordNode = fieldRefs.current.password;
                  const confirmNode = fieldRefs.current.confirm;
                  if (passwordNode instanceof HTMLInputElement) passwordNode.value = "";
                  if (confirmNode instanceof HTMLInputElement) confirmNode.value = "";
                }}
              />
              Send a reset email
            </label>
          </fieldset>
          {mode === "set" ? (
            <>
              <div className="field">
                <label htmlFor={passwordId}>Password</label>
                <input
                  id={passwordId}
                  ref={(node) => {
                    fieldRefs.current.password = node;
                  }}
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  aria-required="true"
                  aria-invalid={formError?.fields.includes("password") || undefined}
                  aria-describedby={passwordHintId}
                  onChange={() => setFormError(null)}
                />
                <p id={passwordHintId} className="field-hint">
                  8 to 200 characters. It is not shown again after you close this form. The user must change it the next
                  time they sign in.
                </p>
              </div>
              <div className="field">
                <label htmlFor={confirmId}>Confirm password</label>
                <input
                  id={confirmId}
                  ref={(node) => {
                    fieldRefs.current.confirm = node;
                  }}
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  aria-required="true"
                  aria-invalid={formError?.fields.includes("confirm") || undefined}
                  onChange={() => setFormError(null)}
                />
              </div>
            </>
          ) : null}
          {mode === "email" ? (
            <p id={modeHintId}>
              A temporary password will be emailed to {user.email}. The email is queued and may arrive later. The
              temporary password is not shown here. The user must change it the next time they sign in.
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">{submitLabel}</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

export function UsersPage() {
  const session = useSession();
  const actor = session?.user.role ?? null;
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Banner | null>(null);
  const [actionError, setActionError] = useState<Banner | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);

  const users = useQuery({
    queryKey: ["users", applied, page],
    enabled: actor === "aa_admin" || actor === "mis",
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listUsers(
        {
          role: applied.role || undefined,
          active: applied.active === "" ? undefined : applied.active === "true",
          page,
          pageSize: applied.pageSize,
        },
        signal,
      ),
  });

  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    if (dialog) {
      node.setAttribute("inert", "");
      return;
    }
    node.removeAttribute("inert");
    if (restoreFocus.current) {
      const target = restoreFocus.current;
      restoreFocus.current = null;
      target.focus();
      return;
    }
    if (notice) noticeRef.current?.focus();
    else if (actionError) actionErrorRef.current?.focus();
  }, [dialog, notice, actionError]);

  if (!session || (actor !== "aa_admin" && actor !== "mis")) return null;

  const result = users.isError ? undefined : users.data;
  const statusText = users.isFetching ? "Loading users." : result ? summary(result) : "";
  const emptyMessage = filtersAreActive(applied) ? "No users match these filters." : "No users are available.";
  const hasNext = result ? result.page * result.pageSize < result.total : false;

  function openDialog(event: MouseEvent<HTMLButtonElement>, next: DialogState) {
    openerRef.current = event.currentTarget;
    restoreFocus.current = null;
    setNotice(null);
    setActionError(null);
    setDialog(next);
  }

  function cancelDialog() {
    restoreFocus.current = openerRef.current;
    setDialog(null);
  }

  function showNotice(message: string) {
    restoreFocus.current = null;
    setActionError(null);
    setNotice({ id: ++bannerSeq.current, message });
    setDialog(null);
  }

  function showProblem(message: string) {
    restoreFocus.current = null;
    setNotice(null);
    setActionError({ id: ++bannerSeq.current, message });
    setDialog(null);
  }

  return (
    <div className="users-page">
      <div ref={pageRef}>
        <h1>Users</h1>
        <p>Create accounts, update them, and reset passwords. A password is not shown again after you close the form.</p>
        {actor === "mis" ? (
          <p>
            You can view AA admin accounts. You cannot create an AA admin, and you cannot edit, activate, deactivate, or
            reset an existing AA admin.
          </p>
        ) : null}
        {notice ? (
          <p key={notice.id} ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
            {notice.message}
          </p>
        ) : null}
        {actionError ? (
          <div key={actionError.id} ref={actionErrorRef} tabIndex={-1} className="form-error" role="alert">
            <p>{actionError.message}</p>
          </div>
        ) : null}
        <p>
          <button type="button" onClick={(event) => openDialog(event, { type: "create" })}>
            Create user
          </button>
        </p>
        <form
          role="search"
          aria-label="Filter users"
          onSubmit={(event) => {
            event.preventDefault();
            const pageSize = isUserPageSize(draft.pageSize) ? draft.pageSize : USER_PAGE_SIZE_DEFAULT;
            const next = { ...draft, pageSize };
            setDraft(next);
            setApplied(next);
            setPage(1);
            setNotice(null);
            setActionError(null);
          }}
        >
          {/* GET /users has no text search. See DECISIONS.md open question 47. */}
          <div className="users-filters">
            <div className="field">
              <label htmlFor="users-filter-role">Role</label>
              <select
                id="users-filter-role"
                name="role"
                value={draft.role}
                onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as Role | "" }))}
              >
                <option value="">Any role</option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="users-filter-active">Account status</label>
              <select
                id="users-filter-active"
                name="active"
                value={draft.active}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, active: event.target.value as Filters["active"] }))
                }
              >
                <option value="">Any status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="users-filter-page-size">Page size</label>
              <select
                id="users-filter-page-size"
                name="pageSize"
                value={draft.pageSize}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!isUserPageSize(value)) return;
                  setDraft((current) => ({ ...current, pageSize: value }));
                }}
              >
                {USER_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="users-filter-actions">
            <button type="submit">Apply filters</button>
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
                setPage(1);
                setNotice(null);
                setActionError(null);
              }}
            >
              Clear filters
            </button>
          </div>
        </form>

        {users.isError && !users.isFetching ? (
          <div className="form-error" role="alert">
            <p>{errorMessage(users.error)}</p>
            <button type="button" onClick={() => void users.refetch()}>
              Try again
            </button>
          </div>
        ) : null}

        {statusText ? (
          <p className="users-summary" role="status">
            {statusText}
          </p>
        ) : null}

        {result ? (
          <>
            <div className="table-scroll">
              <table className="users-table" aria-busy={users.isFetching}>
                <caption className="visually-hidden">User accounts</caption>
                <thead>
                  <tr>
                    {COLUMNS.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.items.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length}>{emptyMessage}</td>
                    </tr>
                  ) : (
                    result.items.map((user) => {
                      const manageable = canManageUser(actor, user.role);
                      return (
                        <tr key={user.id}>
                          <td>{user.name}</td>
                          <td>{user.email}</td>
                          <td>{ROLE_LABELS[user.role]}</td>
                          <td>{user.active ? "Active" : "Inactive"}</td>
                          <td>{user.mustChangePassword ? "Required" : "Not required"}</td>
                          <td>
                            {manageable ? (
                              <div className="row-actions">
                                <button type="button" className="button-quiet" onClick={(event) => openDialog(event, { type: "edit", user })}>
                                  Edit {user.name}
                                </button>
                                <button
                                  type="button"
                                  className="button-quiet"
                                  onClick={(event) =>
                                    openDialog(event, { type: "active", user, nextActive: !user.active })
                                  }
                                >
                                  {user.active ? "Deactivate" : "Activate"} {user.name}
                                </button>
                                <button
                                  type="button"
                                  className="button-quiet"
                                  onClick={(event) => openDialog(event, { type: "reset", user })}
                                >
                                  Reset password for {user.name}
                                </button>
                              </div>
                            ) : (
                              "Cannot edit or reset"
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <nav className="users-pager" aria-label="User pages">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={result.page <= 1 || users.isFetching}
              >
                Previous page
              </button>
              <button type="button" onClick={() => setPage((current) => current + 1)} disabled={!hasNext || users.isFetching}>
                Next page
              </button>
            </nav>
          </>
        ) : null}
      </div>

      {dialog?.type === "create" ? <UserForm actor={actor} user={null} onCancel={cancelDialog} onSaved={showNotice} /> : null}
      {dialog?.type === "edit" ? (
        <UserForm actor={actor} user={dialog.user} onCancel={cancelDialog} onSaved={showNotice} />
      ) : null}
      {dialog?.type === "active" ? (
        <ActiveConfirm user={dialog.user} nextActive={dialog.nextActive} onCancel={cancelDialog} onSaved={showNotice} />
      ) : null}
      {dialog?.type === "reset" ? (
        <PasswordResetDialog user={dialog.user} onCancel={cancelDialog} onSaved={showNotice} onProblem={showProblem} />
      ) : null}
    </div>
  );
}
