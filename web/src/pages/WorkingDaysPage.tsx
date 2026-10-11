import { useEffect, useId, useRef, useState, type MouseEvent, type RefObject } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../api/session";
import {
  createHoliday,
  deleteHoliday,
  getWorkingDayConfig,
  listHolidays,
  saveWorkingDayConfig,
  WEEKDAYS,
  type Holiday,
  type HolidayList,
  type Weekday,
  type WorkingDayConfig,
} from "../api/workingDays";
import { WORKING_DAY_ROLES } from "../routing/access";
import { Dialog, FormAlert } from "./masterData/dialog";
import { useFormErrorFocus } from "./masterData/useFormErrorFocus";
import {
  buildHoliday,
  buildWeekendDays,
  formatWorkingDayError,
  holidayFilterError,
  type HolidayDraft,
} from "./workingDayWrite";

type Banner = { id: number; message: string };
type FormError = { id: number; message: string; fields: string[] };
type DateFilters = { from: string; to: string };

const EMPTY_FILTERS: DateFilters = { from: "", to: "" };
const EMPTY_HOLIDAY: HolidayDraft = { date: "", name: "", region: "" };
const WEEKEND_FIELDS = ["weekendDays"] as const;
const HOLIDAY_FIELDS = ["date", "name", "region"] as const;

const DUE_DATE_NOTE =
  "This does not rewrite accept, assign, or result due dates already stored on existing batches.";

function describedBy(ids: Array<string | null | undefined>): string | undefined {
  const value = ids.filter((id): id is string => Boolean(id)).join(" ");
  return value.length > 0 ? value : undefined;
}

function regionLabel(region: string | null): string {
  return region ?? "AA-wide";
}

function deleteName(holiday: Holiday): string {
  const place = holiday.region ? `, ${holiday.region}` : "";
  return `Delete ${holiday.name} on ${holiday.date}${place}`;
}

function holidaySummary(count: number, filtered: boolean): string {
  const noun = count === 1 ? "holiday" : "holidays";
  return filtered ? `${count} ${noun} in this date range.` : `${count} ${noun} recorded.`;
}

function selectionHint(selected: number): string {
  const working = 7 - selected;
  const selectedLabel = selected === 1 ? "1 weekend day selected." : `${selected} weekend days selected.`;
  const workingLabel = working === 1 ? "1 day stays a working day." : `${working} days stay working days.`;
  return `${selectedLabel} ${workingLabel}`;
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [error]);

  return (
    <div ref={ref} tabIndex={-1} className="form-error" role="alert">
      <p>{formatWorkingDayError(error).message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function WeekendForm({ config }: { config: WorkingDayConfig }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<Weekday[]>(() => [...config.weekendDays]);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [notice, setNotice] = useState<Banner | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const errorSeq = useRef(0);
  const noticeSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  const hintId = useId();
  const dueId = useId();
  const timezoneId = useId();
  useFormErrorFocus(formError, fieldRefs, WEEKEND_FIELDS);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const invalid = formError?.fields.includes("weekendDays") ?? false;

  return (
    <section aria-labelledby="weekend-heading">
      <h2 id="weekend-heading">Weekend days</h2>
      <p id={dueId}>Changing weekend days does not rewrite accept, assign, or result due dates already stored on existing batches.</p>
      {notice ? (
        <p key={notice.id} ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
          {notice.message}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor={timezoneId}>Timezone</label>
        <input id={timezoneId} name="timezone" value={config.timezone} readOnly />
      </div>
      <p className="field-hint">The timezone is read-only.</p>
      <form
        noValidate
        aria-label="Weekend days"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const built = buildWeekendDays(days);
          if (!built.ok) {
            setNotice(null);
            setFormError({ id: ++errorSeq.current, message: built.message, fields: built.fields });
            return;
          }
          setPending(true);
          setFormError(null);
          setNotice(null);
          void (async () => {
            try {
              const saved = await saveWorkingDayConfig(built.weekendDays);
              await queryClient.invalidateQueries({ queryKey: ["admin", "working-day-config"] });
              if (!mounted.current) return;
              setDays(saved.weekendDays);
              setPending(false);
              setNotice({
                id: ++noticeSeq.current,
                message: `Weekend days were saved. ${DUE_DATE_NOTE}`,
              });
            } catch (error) {
              if (!mounted.current) return;
              const formatted = formatWorkingDayError(error);
              setPending(false);
              setFormError({ id: ++errorSeq.current, message: formatted.message, fields: formatted.fields });
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />
          <fieldset
            ref={(node) => {
              fieldRefs.current.weekendDays = node;
            }}
            tabIndex={-1}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy([hintId, dueId, invalid ? errorId : null])}
          >
            <legend>Weekend days</legend>
            <p id={hintId} className="field-hint">
              Sunday is 0 and Saturday is 6. Select the days that are not working days. Leave at least one day
              unselected. {selectionHint(days.length)}
            </p>
            <ul className="choice-list">
              {WEEKDAYS.map((day) => {
                const inputId = `weekend-day-${day.value}`;
                return (
                  <li key={day.value}>
                    <label className="check-label" htmlFor={inputId}>
                      <input
                        id={inputId}
                        name="weekendDays"
                        type="checkbox"
                        value={day.value}
                        checked={days.includes(day.value)}
                        onChange={(event) => {
                          const on = event.target.checked;
                          setDays((current) => {
                            const next = on
                              ? current.includes(day.value)
                                ? current
                                : [...current, day.value]
                              : current.filter((item) => item !== day.value);
                            return [...next].sort((left, right) => left - right);
                          });
                          setFormError(null);
                        }}
                      />
                      {day.label}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <button type="submit">Save weekend days</button>
        </fieldset>
      </form>
    </section>
  );
}

function WeekendSection() {
  const config = useQuery({
    queryKey: ["admin", "working-day-config"],
    queryFn: ({ signal }) => getWorkingDayConfig(signal),
  });

  if (config.isPending) return <p role="status">Loading working-day settings.</p>;
  if (config.isError) {
    return (
      <section aria-labelledby="weekend-heading">
        <h2 id="weekend-heading">Weekend days</h2>
        <LoadError error={config.error} onRetry={() => void config.refetch()} />
      </section>
    );
  }
  return <WeekendForm config={config.data} />;
}

function HolidaySection({
  notice,
  noticeRef,
  onAskDelete,
  onNotice,
  onClearNotice,
}: {
  notice: Banner | null;
  noticeRef: RefObject<HTMLParagraphElement>;
  onAskDelete: (event: MouseEvent<HTMLButtonElement>, holiday: Holiday) => void;
  onNotice: (message: string) => void;
  onClearNotice: () => void;
}) {
  const queryClient = useQueryClient();
  const [draftFilters, setDraftFilters] = useState<DateFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DateFilters>(EMPTY_FILTERS);
  const [filterError, setFilterError] = useState<FormError | null>(null);
  const [draft, setDraft] = useState<HolidayDraft>(EMPTY_HOLIDAY);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const filterRefs = useRef<Partial<Record<string, HTMLInputElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  const filterErrorId = useId();
  const regionHintId = useId();
  const dueId = useId();
  useFormErrorFocus(formError, fieldRefs, HOLIDAY_FIELDS);

  const holidays = useQuery({
    queryKey: ["admin", "holidays", applied],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listHolidays(
        {
          from: applied.from || undefined,
          to: applied.to || undefined,
        },
        signal,
      ),
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const result: HolidayList | undefined = holidays.isError ? undefined : holidays.data;
  const filtered = Boolean(applied.from || applied.to);
  const summary =
    holidays.isError && !holidays.isFetching
      ? ""
      : holidays.isFetching || !result
        ? "Loading holidays."
        : holidaySummary(result.items.length, filtered);
  const emptyMessage = filtered ? "No holidays match these dates." : "No holidays are recorded.";

  function invalid(field: string): boolean {
    return formError?.fields.includes(field) ?? false;
  }

  return (
    <section aria-labelledby="holiday-heading">
      <h2 id="holiday-heading">Holidays</h2>
      <p id={dueId}>Adding or deleting a holiday does not rewrite accept, assign, or result due dates already stored on existing batches.</p>
      <p>
        Region is accepted. Batches do not use it yet, so a regional holiday is stored and is not applied when batch
        due dates are calculated.
      </p>
      {notice ? (
        <p key={notice.id} ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
          {notice.message}
        </p>
      ) : null}

      <form
        noValidate
        aria-label="Add a holiday"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const built = buildHoliday(draft);
          if (!built.ok) {
            onClearNotice();
            setFormError({ id: ++errorSeq.current, message: built.message, fields: built.fields });
            return;
          }
          setPending(true);
          setFormError(null);
          onClearNotice();
          void (async () => {
            try {
              const saved = await createHoliday(built.body);
              await queryClient.invalidateQueries({ queryKey: ["admin", "holidays"] });
              if (!mounted.current) return;
              setDraft(EMPTY_HOLIDAY);
              setPending(false);
              const place = saved.region ? ` (${saved.region})` : "";
              onNotice(`${saved.name} on ${saved.date}${place} was added. ${DUE_DATE_NOTE}`);
            } catch (error) {
              if (!mounted.current) return;
              const formatted = formatWorkingDayError(error);
              setPending(false);
              setFormError({ id: ++errorSeq.current, message: formatted.message, fields: formatted.fields });
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />
          <div className="holiday-fields">
            <div className="field">
              <label htmlFor="holiday-date">Holiday date</label>
              <input
                id="holiday-date"
                ref={(node) => {
                  fieldRefs.current.date = node;
                }}
                name="date"
                type="date"
                required
                value={draft.date}
                aria-invalid={invalid("date") || undefined}
                aria-describedby={describedBy([invalid("date") ? errorId : null])}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, date: event.target.value }));
                  setFormError(null);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="holiday-name">Holiday name</label>
              <input
                id="holiday-name"
                ref={(node) => {
                  fieldRefs.current.name = node;
                }}
                name="name"
                type="text"
                required
                value={draft.name}
                autoComplete="off"
                aria-invalid={invalid("name") || undefined}
                aria-describedby={describedBy([invalid("name") ? errorId : null])}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, name: event.target.value }));
                  setFormError(null);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="holiday-region">Region</label>
              <input
                id="holiday-region"
                ref={(node) => {
                  fieldRefs.current.region = node;
                }}
                name="region"
                type="text"
                value={draft.region}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={invalid("region") || undefined}
                aria-describedby={describedBy([regionHintId, invalid("region") ? errorId : null])}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, region: event.target.value }));
                  setFormError(null);
                }}
              />
              <p id={regionHintId} className="field-hint">
                Optional. Leave this blank for an AA-wide holiday.
              </p>
            </div>
          </div>
          <button type="submit">Add holiday</button>
        </fieldset>
      </form>

      <form
        role="search"
        aria-label="Filter holidays"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const next = { from: draftFilters.from, to: draftFilters.to };
          const problem = holidayFilterError(next.from, next.to);
          if (problem) {
            const error = { id: ++errorSeq.current, message: problem.message, fields: problem.fields };
            setFilterError(error);
            const first = (["from", "to"] as const).find((key) => problem.fields.includes(key));
            if (first) filterRefs.current[first]?.focus();
            return;
          }
          setDraftFilters(next);
          setApplied(next);
          setFilterError(null);
        }}
      >
        <div className="working-filters">
          <div className="field">
            <label htmlFor="holiday-from">From date</label>
            <input
              id="holiday-from"
              ref={(node) => {
                filterRefs.current.from = node;
              }}
              name="from"
              type="date"
              value={draftFilters.from}
              aria-invalid={filterError?.fields.includes("from") || undefined}
              aria-describedby={filterError?.fields.includes("from") ? filterErrorId : undefined}
              onChange={(event) => {
                setDraftFilters((current) => ({ ...current, from: event.target.value }));
                setFilterError(null);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="holiday-to">To date</label>
            <input
              id="holiday-to"
              ref={(node) => {
                filterRefs.current.to = node;
              }}
              name="to"
              type="date"
              value={draftFilters.to}
              aria-invalid={filterError?.fields.includes("to") || undefined}
              aria-describedby={filterError?.fields.includes("to") ? filterErrorId : undefined}
              onChange={(event) => {
                setDraftFilters((current) => ({ ...current, to: event.target.value }));
                setFilterError(null);
              }}
            />
          </div>
        </div>
        {filterError ? (
          <p id={filterErrorId} className="form-error" role="alert">
            {filterError.message}
          </p>
        ) : null}
        <div className="working-filter-actions">
          <button type="submit">Apply filters</button>
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              setDraftFilters(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              setFilterError(null);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>

      {holidays.isError && !holidays.isFetching ? (
        <LoadError error={holidays.error} onRetry={() => void holidays.refetch()} />
      ) : null}
      {summary ? (
        <p className="working-summary" role="status">
          {summary}
        </p>
      ) : null}
      {result ? (
        <div className="table-scroll">
          <table className="working-table" aria-busy={holidays.isFetching}>
            <caption className="visually-hidden">Holidays</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Name</th>
                <th scope="col">Region</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.items.length === 0 ? (
                <tr>
                  <td colSpan={4}>{emptyMessage}</td>
                </tr>
              ) : (
                result.items.map((holiday) => (
                  <tr key={holiday.id}>
                    <td>{holiday.date}</td>
                    <td>{holiday.name}</td>
                    <td>{regionLabel(holiday.region)}</td>
                    <td>
                      <button type="button" className="button-quiet" onClick={(event) => onAskDelete(event, holiday)}>
                        {deleteName(holiday)}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="field-hint">
        {filtered ? "Showing every holiday in this date range." : "Showing every recorded holiday."}
      </p>
    </section>
  );
}

function DeleteHolidayDialog({
  holiday,
  onCancel,
  onDeleted,
}: {
  holiday: Holiday;
  onCancel: () => void;
  onDeleted: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <Dialog title={`Delete ${holiday.name}?`} busy={pending} initialFocus="cancel" onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              await deleteHoliday(holiday.id);
              await queryClient.invalidateQueries({ queryKey: ["admin", "holidays"] });
              if (!mounted.current) return;
              onDeleted(`${holiday.name} on ${holiday.date} was deleted. ${DUE_DATE_NOTE}`);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              setFormError({
                id: ++errorSeq.current,
                message: formatWorkingDayError(error).message,
                fields: [],
              });
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <p>
            Delete {holiday.name} on {holiday.date} ({regionLabel(holiday.region)})?
          </p>
          <p>{DUE_DATE_NOTE}</p>
          <FormAlert error={formError} id={errorId} />
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Delete holiday</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

export function WorkingDaysPage() {
  const session = useSession();
  const pageRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const noticeSeq = useRef(0);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [holidayNotice, setHolidayNotice] = useState<Banner | null>(null);

  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    if (deleteTarget) {
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
    if (holidayNotice) noticeRef.current?.focus();
  }, [deleteTarget, holidayNotice]);

  if (!session || !WORKING_DAY_ROLES.includes(session.user.role)) return null;

  return (
    <div className="working-days-page">
      <div ref={pageRef}>
        <h1>Working days</h1>
        <p>Choose which weekdays are weekends, and record holidays.</p>
        <WeekendSection />
        <HolidaySection
          notice={holidayNotice}
          noticeRef={noticeRef}
          onAskDelete={(event, holiday) => {
            openerRef.current = event.currentTarget;
            restoreFocus.current = null;
            setHolidayNotice(null);
            setDeleteTarget(holiday);
          }}
          onNotice={(message) => {
            restoreFocus.current = null;
            setHolidayNotice({ id: ++noticeSeq.current, message });
          }}
          onClearNotice={() => setHolidayNotice(null)}
        />
      </div>
      {deleteTarget ? (
        <DeleteHolidayDialog
          holiday={deleteTarget}
          onCancel={() => {
            restoreFocus.current = openerRef.current;
            setDeleteTarget(null);
          }}
          onDeleted={(message) => {
            restoreFocus.current = null;
            setHolidayNotice({ id: ++noticeSeq.current, message });
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
