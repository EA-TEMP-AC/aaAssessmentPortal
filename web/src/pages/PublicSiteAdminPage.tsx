import { useEffect, useId, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  archivePublicSiteItem,
  listPublicSite,
  PUBLIC_SITE_PAGE_SIZE,
  updatePublicSiteItem,
  type PublicSiteItem,
} from "../api/publicSite";
import { useSession } from "../api/session";
import { Dialog } from "./masterData/dialog";
import { ItemForm } from "./publicSite/ItemForm";
import { SECTIONS, sectionFor, type SectionDef } from "./publicSite/sections";
import { formatPublicSiteError, MIS_PUBLISH_REASON } from "./publicSite/write";

type Status = "all" | "draft" | "published";
type Banner = { id: number; message: string };
type Failure = { id: number; message: string };

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value);
}

function statusOf(item: PublicSiteItem): "Archived" | "Published" | "Draft" {
  if (item.archived) return "Archived";
  return item.published ? "Published" : "Draft";
}

function itemName(section: SectionDef, item: PublicSiteItem): string {
  const value = item.fields[section.titleField];
  return typeof value === "string" && value.length > 0 ? value : `${section.singular} ${item.id}`;
}

export function PublicSiteAdminPage() {
  const session = useSession();
  const canPublish = session?.user.role === "aa_admin";
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const section = sectionFor(params.get("section"));
  const showArchived = params.get("archived") === "1";
  const status: Status = params.get("status") === "draft" ? "draft" : params.get("status") === "published" ? "published" : "all";
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ item: PublicSiteItem | null } | null>(null);
  const [archiving, setArchiving] = useState<PublicSiteItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Banner | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  const seq = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const misNoteId = useId();

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  function update(next: Record<string, string | null>) {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy);
    setPage(1);
    setNotice(null);
    setFailure(null);
  }

  const list = useQuery({
    queryKey: ["admin", "public-site", section.slug, { showArchived, status, page }],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listPublicSite(
        section.slug,
        {
          page,
          pageSize: PUBLIC_SITE_PAGE_SIZE,
          archived: showArchived,
          published: showArchived || status === "all" ? undefined : status === "published",
        },
        signal,
      ),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin", "public-site"] });
  }

  function restoreFocus() {
    const node = opener.current;
    if (node?.isConnected) node.focus();
  }

  function openDialog(event: { currentTarget: HTMLElement }, next: { item: PublicSiteItem | null }) {
    opener.current = event.currentTarget;
    setNotice(null);
    setFailure(null);
    setEditing(next);
  }

  async function setPublished(item: PublicSiteItem, published: boolean) {
    const name = itemName(section, item);
    setBusyId(item.id);
    setNotice(null);
    setFailure(null);
    try {
      await updatePublicSiteItem(section.slug, item.id, { published });
      await refresh();
      setNotice({ id: ++seq.current, message: `${name} is now ${published ? "published" : "a draft"}.` });
    } catch (error) {
      setFailure({ id: ++seq.current, message: formatPublicSiteError(section, error).message });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmArchive(item: PublicSiteItem) {
    const name = itemName(section, item);
    setBusyId(item.id);
    setArchiving(null);
    setNotice(null);
    setFailure(null);
    try {
      await archivePublicSiteItem(section.slug, item.id);
      await refresh();
      setNotice({ id: ++seq.current, message: `${name} was archived and is no longer on the public site.` });
    } catch (error) {
      setFailure({ id: ++seq.current, message: formatPublicSiteError(section, error).message });
    } finally {
      setBusyId(null);
    }
  }

  const result = list.isError ? undefined : list.data;
  const total = result?.total ?? 0;
  const hasNext = result ? result.page * result.pageSize < total : false;
  const noun = showArchived ? "archived items" : "items";
  const summary = list.isError && !list.isFetching
    ? ""
    : list.isFetching || !result
      ? `Loading ${section.label.toLowerCase()}.`
      : `${total} ${total === 1 ? "item" : noun} in ${section.label}.`;

  function actions(item: PublicSiteItem) {
    const name = itemName(section, item);
    const busy = busyId === item.id;
    if (item.archived) return <span>No actions</span>;
    const misLocked = !canPublish && item.published;
    return (
      <div className="row-actions">
        <button
          type="button"
          className="button-quiet"
          disabled={busy || misLocked}
          aria-describedby={misLocked ? misNoteId : undefined}
          onClick={(event) => openDialog(event, { item })}
        >
          Edit {name}
        </button>
        {canPublish ? (
          item.published ? (
            <button type="button" className="button-quiet" disabled={busy} onClick={() => void setPublished(item, false)}>
              Unpublish {name}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void setPublished(item, true)}>
              Publish {name}
            </button>
          )
        ) : null}
        {canPublish ? (
          <button
            type="button"
            className="button-quiet"
            disabled={busy}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setArchiving(item);
            }}
          >
            Archive {name}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <h1>Public site</h1>
      <p>Content for the public website. Drafts are never shown publicly. Archiving takes an item off the public site and keeps its record.</p>
      {canPublish ? null : (
        <p id={misNoteId} className="field-hint" role="note">
          {MIS_PUBLISH_REASON}
        </p>
      )}

      <nav aria-label="Public site sections">
        <ul className="master-subnav">
          {SECTIONS.map((entry) => (
            <li key={entry.slug}>
              <Link
                to={`?section=${entry.slug}`}
                aria-current={entry.slug === section.slug ? "page" : undefined}
                onClick={() => {
                  setPage(1);
                  setNotice(null);
                  setFailure(null);
                }}
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="public-site-section">
        <h2 id="public-site-section">{section.label}</h2>
        <p>{section.intro}</p>
        {section.warning ? (
          <p className="public-warning" role="note">
            {section.warning}
          </p>
        ) : null}

        {notice ? (
          <p key={notice.id} ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
            {notice.message}
          </p>
        ) : null}
        {failure ? (
          <p key={failure.id} ref={failureRef} tabIndex={-1} className="form-error" role="alert">
            {failure.message}
          </p>
        ) : null}

        <div className="master-filters">
          <div className="field">
            <label htmlFor="public-site-status">Status</label>
            <select
              id="public-site-status"
              value={status}
              disabled={showArchived}
              onChange={(event) => update({ status: event.target.value === "all" ? null : event.target.value })}
            >
              <option value="all">Draft and published</option>
              <option value="draft">Drafts only</option>
              <option value="published">Published only</option>
            </select>
          </div>
          <div className="field">
            <label className="check-label" htmlFor="public-site-archived">
              <input
                id="public-site-archived"
                type="checkbox"
                checked={showArchived}
                onChange={(event) => update({ archived: event.target.checked ? "1" : null })}
              />
              Show archived
            </label>
            <p className="field-hint">Lists archived items only. Archived items cannot be edited or restored here.</p>
          </div>
        </div>

        {showArchived ? null : (
          <p>
            <button type="button" onClick={(event) => openDialog(event, { item: null })}>
              Add {section.singular}
            </button>
          </p>
        )}

        {list.isError && !list.isFetching ? (
          <div className="form-error" role="alert">
            <p>{formatPublicSiteError(section, list.error).message}</p>
            <button type="button" onClick={() => void list.refetch()}>
              Try again
            </button>
          </div>
        ) : null}

        {summary ? (
          <p className="master-summary" role="status">
            {summary}
          </p>
        ) : null}

        {result && result.items.length === 0 && !list.isFetching ? (
          <p>
            {showArchived
              ? `No archived ${section.label.toLowerCase()}.`
              : status === "all"
                ? `No ${section.label.toLowerCase()} yet. Use "Add ${section.singular}" to create the first draft.`
                : `No ${status === "draft" ? "drafts" : "published items"} in ${section.label}.`}
          </p>
        ) : null}

        {result && result.items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="master-table" aria-busy={list.isFetching || undefined}>
                <caption className="visually-hidden">{section.label}</caption>
                <thead>
                  <tr>
                    <th scope="col">{section.fields.find((f) => f.name === section.titleField)?.label ?? "Name"}</th>
                    {section.summaryFields.map((name) => (
                      <th key={name} scope="col">
                        {section.fields.find((f) => f.name === name)?.label ?? name}
                      </th>
                    ))}
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <th scope="row">{itemName(section, item)}</th>
                      {section.summaryFields.map((name) => (
                        <td key={name}>{cell(item.fields[name])}</td>
                      ))}
                      <td>{statusOf(item)}</td>
                      <td>{actions(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="master-pager" aria-label={`${section.label} pages`}>
              <button type="button" disabled={page <= 1 || list.isFetching} onClick={() => setPage((current) => current - 1)}>
                Previous page
              </button>
              <button type="button" disabled={!hasNext || list.isFetching} onClick={() => setPage((current) => current + 1)}>
                Next page
              </button>
            </nav>
          </>
        ) : null}
      </section>

      {editing ? (
        <ItemForm
          section={section}
          item={editing.item}
          onCancel={() => {
            setEditing(null);
            restoreFocus();
          }}
          onSaved={(saved) => {
            const wasNew = editing.item === null;
            setEditing(null);
            void refresh().then(() => {
              setNotice({
                id: ++seq.current,
                message: wasNew
                  ? `${itemName(section, saved)} was saved as a draft.`
                  : `${itemName(section, saved)} was saved.`,
              });
            });
          }}
        />
      ) : null}

      {archiving ? (
        <Dialog
          title={`Archive ${itemName(section, archiving)}?`}
          initialFocus="cancel"
          onCancel={() => {
            setArchiving(null);
            restoreFocus();
          }}
        >
          <p>
            This removes the item from the public site. It stays on record, cannot be edited or restored from this screen,
            and is listed under Show archived.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => void confirmArchive(archiving)}>
              Archive
            </button>
            <button
              type="button"
              className="button-quiet"
              data-dialog-cancel
              onClick={() => {
                setArchiving(null);
                restoreFocus();
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
