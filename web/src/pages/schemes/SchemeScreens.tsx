import { Fragment, useId, useState, type MouseEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MasterListPage, MasterPageSize } from "../../api/masterData";
import {
  deactivateProject,
  deactivateScheme,
  deactivateSignatory,
  isSignatoryScope,
  listProjects,
  listSchemes,
  listSignatories,
  SIGNATORY_SCOPES,
  type Project,
  type Scheme,
  type Signatory,
} from "../../api/schemes";
import { useSession } from "../../api/session";
import { SCHEME_READ_ROLES, canWriteSchemes } from "../../routing/access";
import { ActiveFilterField, ListScaffold, PageSizeField } from "../masterData/listScaffold";
import { READ_ONLY_NOTE, emptyListMessage, listSummary } from "../masterData/listText";
import { useMasterDialog } from "../masterData/useMasterDialog";
import { DeactivateDialog, ProjectForm, SchemeForm, SignatoryForm } from "./SchemeForms";
import { SCHEME_DATA_KEY, SCOPE_LABELS } from "./schemeData";

type Filters = {
  active: "" | "true" | "false";
  pageSize: MasterPageSize;
  schemeId: string;
  scope: string;
};

const EMPTY_FILTERS: Filters = { active: "", pageSize: 20, schemeId: "", scope: "" };

type Row = { id: string; name: string; active: boolean };

type DialogState<T> = { type: "create" } | { type: "edit"; record: T } | { type: "deactivate"; record: T };

type Config<T extends Row> = {
  resource: "schemes" | "projects" | "signatories";
  title: string;
  one: string;
  many: string;
  lede: string;
  columns: readonly string[];
  /** Filter fields beyond status and page size. */
  scopeFilter?: boolean;
  schemeFilter?: boolean;
  load: (filters: Filters, page: number, signal: AbortSignal) => Promise<MasterListPage<T>>;
  cells: (record: T, schemeNames: ReadonlyMap<string, string>) => ReactNode[];
  form: (props: { record: T | null; onCancel: () => void; onSaved: (message: string) => void }) => ReactNode;
  deactivate: (record: T) => Promise<string>;
};

function display(value: string | null | undefined): string {
  return value && value.trim() ? value : "None";
}

function ResourceScreen<T extends Row>({ config }: { config: Config<T> }) {
  const session = useSession();
  const role = session?.user.role ?? null;
  const canRead = role ? SCHEME_READ_ROLES.includes(role) : false;
  const canWrite = role ? canWriteSchemes(role) : false;
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DialogState<T> | null>(null);
  const chrome = useMasterDialog(dialog !== null);
  const schemeFilterId = useId();
  const scopeFilterId = useId();
  const needsSchemeNames = Boolean(config.schemeFilter || config.resource === "signatories");
  const schemeNames = useQuery({
    queryKey: [SCHEME_DATA_KEY, "scheme-names"],
    enabled: canRead && needsSchemeNames,
    queryFn: ({ signal }) => listSchemes({ page: 1, pageSize: 100 }, signal),
  });

  const records = useQuery({
    queryKey: [SCHEME_DATA_KEY, config.resource, applied, page],
    enabled: canRead,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => config.load(applied, page, signal),
  });

  if (!session || !role) return null;

  if (!canRead) {
    return (
      <>
        <h1>{config.title}</h1>
        <p role="status">This list is not available for your role.</p>
      </>
    );
  }

  const nameById = new Map<string, string>((schemeNames.data?.items ?? []).map((item) => [item.id, `${item.name} (${item.code})`]));
  const result = records.isError ? undefined : records.data;
  const filtered = Boolean(applied.active || applied.schemeId || applied.scope);
  const columns = [...config.columns, "Status", ...(canWrite ? ["Actions"] : [])];
  const notes: string[] = [];
  if (!canWrite) notes.push(READ_ONLY_NOTE);
  else notes.push(`A ${config.one} is never deleted. Deactivate it instead.`);

  function openDialog(event: MouseEvent<HTMLButtonElement>, next: DialogState<T>) {
    chrome.rememberOpener(event);
    setDialog(next);
  }

  function cancelDialog() {
    chrome.closeDialog();
    setDialog(null);
  }

  function onSaved(message: string) {
    chrome.showNotice(message);
    setDialog(null);
  }

  const pickedScheme = (value: string) => setDraftFilters((current) => ({ ...current, schemeId: value }));

  return (
    <ListScaffold
      title={config.title}
      lede={config.lede}
      notes={notes}
      canWrite={canWrite}
      createLabel={`Create ${config.one}`}
      onCreate={(event) => openDialog(event, { type: "create" })}
      filterLabel={`Filter ${config.many}`}
      filters={
        <>
          <ActiveFilterField
            id={`${config.resource}-active`}
            value={draftFilters.active}
            onChange={(active) => setDraftFilters((current) => ({ ...current, active }))}
          />
          {config.scopeFilter ? (
            <div className="field">
              <label htmlFor={scopeFilterId}>Scope</label>
              <select
                id={scopeFilterId}
                name="scope"
                value={draftFilters.scope}
                onChange={(event) => setDraftFilters((current) => ({ ...current, scope: event.target.value }))}
              >
                <option value="">Any scope</option>
                {SIGNATORY_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABELS[scope]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {config.schemeFilter ? (
            <div className="field">
              <label htmlFor={schemeFilterId}>Scheme</label>
              <select id={schemeFilterId} name="schemeId" value={draftFilters.schemeId} onChange={(event) => pickedScheme(event.target.value)}>
                <option value="">Any scheme</option>
                {(schemeNames.data?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <PageSizeField
            id={`${config.resource}-page-size`}
            value={draftFilters.pageSize}
            onChange={(pageSize) => setDraftFilters((current) => ({ ...current, pageSize }))}
          />
        </>
      }
      onApply={() => {
        chrome.setNotice(null);
        setApplied(draftFilters);
        setPage(1);
      }}
      onClear={() => {
        setDraftFilters(EMPTY_FILTERS);
        setApplied(EMPTY_FILTERS);
        setPage(1);
        chrome.setNotice(null);
      }}
      filterError={null}
      isError={records.isError}
      isFetching={records.isFetching}
      error={records.error}
      onRetry={() => void records.refetch()}
      summary={
        records.isFetching
          ? `Loading ${config.many}.`
          : result
            ? listSummary(result.page, result.pageSize, result.total, config.one, config.many)
            : ""
      }
      columns={columns}
      caption={config.title}
      rows={
        result && result.items.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{emptyListMessage(config.many, filtered)}</td>
          </tr>
        ) : (
          result?.items.map((record) => (
            <tr key={record.id}>
              {[...config.cells(record, nameById), record.active ? "Active" : "Inactive"].map((cell, index) => (
                <td key={columns[index] ?? index}>{cell}</td>
              ))}
              {canWrite ? (
                <td>
                  <div className="row-actions">
                    <button type="button" className="button-quiet" onClick={(event) => openDialog(event, { type: "edit", record })}>
                      Edit {record.name}
                    </button>
                    {record.active ? (
                      <button type="button" className="button-quiet" onClick={(event) => openDialog(event, { type: "deactivate", record })}>
                        Deactivate {record.name}
                      </button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))
        )
      }
      showTable={Boolean(result)}
      page={result?.page ?? 1}
      hasNext={result ? result.page * result.pageSize < result.total : false}
      onPrevious={() => setPage((current) => Math.max(1, current - 1))}
      onNext={() => setPage((current) => current + 1)}
      pagerLabel={`${config.title} pages`}
      pageRef={chrome.pageRef}
      notice={chrome.notice}
      noticeRef={chrome.noticeRef}
      dialog={
        dialog?.type === "create" ? (
          config.form({ record: null, onCancel: cancelDialog, onSaved })
        ) : dialog?.type === "edit" ? (
          <Fragment key={dialog.record.id}>{config.form({ record: dialog.record, onCancel: cancelDialog, onSaved })}</Fragment>
        ) : dialog?.type === "deactivate" ? (
          <DeactivateDialog
            name={dialog.record.name}
            one={config.one}
            run={() => config.deactivate(dialog.record)}
            onCancel={cancelDialog}
            onSaved={onSaved}
          />
        ) : null
      }
    />
  );
}

function activeQuery(filters: Filters, page: number) {
  return {
    active: filters.active === "" ? undefined : filters.active === "true",
    page,
    pageSize: filters.pageSize,
  };
}

const SCHEME_CONFIG: Config<Scheme> = {
  resource: "schemes",
  title: "Schemes",
  one: "scheme",
  many: "schemes",
  lede: "Funding schemes. A batch can be linked to a scheme when it is created.",
  columns: ["Name", "Code", "Funding body"],
  load: (filters, page, signal) => listSchemes(activeQuery(filters, page), signal),
  cells: (record) => [record.name, record.code, record.fundingBody],
  form: (props) => <SchemeForm {...props} />,
  deactivate: async (record) => `${(await deactivateScheme(record.id)).name} is now inactive.`,
};

const PROJECT_CONFIG: Config<Project> = {
  resource: "projects",
  title: "Projects",
  one: "project",
  many: "projects",
  lede: "Projects belong to a scheme. A batch can be linked to a project when it is created.",
  columns: ["Name", "Code", "Scheme", "Start date", "End date"],
  schemeFilter: true,
  load: (filters, page, signal) => listProjects({ ...activeQuery(filters, page), schemeId: filters.schemeId || undefined }, signal),
  cells: (record, names) => [record.name, record.code, names.get(record.schemeId) ?? record.schemeId, record.startDate, record.endDate ?? "Open-ended"],
  form: (props) => <ProjectForm {...props} />,
  deactivate: async (record) => `${(await deactivateProject(record.id)).name} is now inactive.`,
};

const SIGNATORY_CONFIG: Config<Signatory> = {
  resource: "signatories",
  title: "Authorised signatories",
  one: "signatory",
  many: "signatories",
  lede: "People who may sign for a scheme, a project, or the whole agency.",
  columns: ["Name", "Designation", "Scope", "Scheme or project", "Valid from", "Valid to"],
  scopeFilter: true,
  schemeFilter: true,
  load: (filters, page, signal) =>
    listSignatories(
      {
        ...activeQuery(filters, page),
        scope: isSignatoryScope(filters.scope) ? filters.scope : undefined,
        schemeId: filters.schemeId || undefined,
      },
      signal,
    ),
  cells: (record, names) => [
    record.name,
    record.designation,
    SCOPE_LABELS[record.scope],
    record.scope === "scheme" && record.schemeId
      ? (names.get(record.schemeId) ?? record.schemeId)
      : record.scope === "project"
        ? display(record.projectId)
        : "Whole agency",
    record.validFrom,
    record.validTo ?? "No end date",
  ],
  form: (props) => <SignatoryForm {...props} />,
  deactivate: async (record) => `${(await deactivateSignatory(record.id)).name} is now inactive.`,
};

export function SchemesPage() {
  return <ResourceScreen config={SCHEME_CONFIG} />;
}

export function ProjectsPage() {
  return <ResourceScreen config={PROJECT_CONFIG} />;
}

export function SignatoriesPage() {
  return <ResourceScreen config={SIGNATORY_CONFIG} />;
}
