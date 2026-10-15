import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { fetchPublic, safeHref, type PublicPage, type PublicSlug } from "./publicApi";
import { initials, PUBLIC_STALE_MS, publicErrorMessage } from "./util";

export function LoadingNote({ label }: { label: string }) {
  return (
    <p role="status" className="site-note">
      Loading {label}…
    </p>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="site-error">
      <p>{publicErrorMessage(error)}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="site-note">{children}</p>;
}

/** Shows an http or https reference as a link and anything else as plain text. */
export function RefLink({ value, label }: { value: string | null | undefined; label: string }) {
  if (!value) return null;
  const href = safeHref(value);
  return href ? (
    <a href={href} rel="noopener noreferrer" target="_blank">
      {label}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  ) : (
    <span>
      {label}: {value}
    </span>
  );
}

/** Photo only when the reference is a web address; otherwise initials. Never read by assistive tech twice. */
export function Avatar({ name, photoRef }: { name: string; photoRef?: string | null }) {
  const href = safeHref(photoRef);
  if (href) {
    return <img className="site-avatar" src={href} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  }
  return (
    <span className="site-avatar site-avatar-initials" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

type PagedProps<T> = {
  slug: PublicSlug;
  label: string;
  params?: Record<string, string | undefined>;
  empty: string;
  children: (items: T[]) => ReactNode;
};

/** Loads one page of a public list, with paging kept in the address (?page=). */
export function PagedList<T>({ slug, label, params = {}, empty, children }: PagedProps<T>) {
  const [search, setSearch] = useSearchParams();
  const requested = Number(search.get("page"));
  const page = Number.isInteger(requested) && requested >= 1 ? requested : 1;
  const key = JSON.stringify(params);

  const query = useQuery<PublicPage<T>>({
    queryKey: ["public", slug, key, page],
    queryFn: () => fetchPublic<T>(slug, { ...params, page }),
    staleTime: PUBLIC_STALE_MS,
    refetchOnWindowFocus: false,
  });

  if (query.isPending) return <LoadingNote label={label} />;
  if (query.isError) return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;

  const { items, total, pageSize } = query.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (items.length === 0 && page === 1) return <EmptyNote>{empty}</EmptyNote>;

  const go = (next: number) => {
    const copy = new URLSearchParams(search);
    if (next <= 1) copy.delete("page");
    else copy.set("page", String(next));
    setSearch(copy);
  };

  return (
    <>
      {items.length === 0 ? <EmptyNote>No more entries on this page.</EmptyNote> : children(items)}
      {pages > 1 || page > 1 ? (
        <nav className="site-pager" aria-label={`${label} pages`}>
          <button type="button" onClick={() => go(page - 1)} disabled={page <= 1}>
            Previous page
          </button>
          <span aria-live="polite">
            Page {page} of {pages}
          </span>
          <button type="button" onClick={() => go(page + 1)} disabled={page >= pages}>
            Next page
          </button>
        </nav>
      ) : null}
    </>
  );
}
