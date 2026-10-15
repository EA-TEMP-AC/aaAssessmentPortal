import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  currentMonthIst,
  daysInMonth,
  dateOnly,
  eventDateRange,
  eventDaysInMonth,
  firstWeekday,
  monthLabel,
  parseMonth,
  shiftMonth,
} from "./calendar";
import { fetchAllPublic, type PublicEvent } from "./publicApi";
import { EmptyNote, ErrorNote, LoadingNote } from "./parts";
import { PUBLIC_STALE_MS, usePageTitle } from "./util";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function MonthGrid({ month, events }: { month: string; events: PublicEvent[] }) {
  const byDay = new Map<number, PublicEvent[]>();
  for (const event of events) {
    for (const day of eventDaysInMonth(event, month)) {
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
  }
  const blanks = firstWeekday(month);
  const cells: (number | null)[] = [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: daysInMonth(month) }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  // The list below carries the same information for screen readers.
  return (
    <table className="site-grid" aria-hidden="true">
      <thead>
        <tr>
          {WEEKDAYS.map((day) => (
            <th key={day} scope="col">
              {day.slice(0, 3)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, row) => (
          <tr key={row}>
            {week.map((day, column) => (
              <td key={column} className={day ? undefined : "site-grid-blank"}>
                {day ? (
                  <>
                    <span className="site-grid-day">{day}</span>
                    {(byDay.get(day) ?? []).map((event) => (
                      <span key={event.id} className="site-grid-event">
                        {event.title}
                      </span>
                    ))}
                  </>
                ) : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EventsPage() {
  const [search] = useSearchParams();
  const month = parseMonth(search.get("month"));
  usePageTitle(`Events, ${monthLabel(month)}`);

  const query = useQuery({
    queryKey: ["public", "events", month],
    queryFn: () => fetchAllPublic<PublicEvent>("events", { month }),
    staleTime: PUBLIC_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const thisMonth = currentMonthIst();

  return (
    <>
      <h1>Events calendar</h1>
      <nav className="site-month-nav" aria-label="Choose month">
        <Link to={`/site/events?month=${previous}`} rel="prev">
          <span aria-hidden="true">← </span>
          {monthLabel(previous)}
        </Link>
        <h2 aria-live="polite">{monthLabel(month)}</h2>
        <Link to={`/site/events?month=${next}`} rel="next">
          {monthLabel(next)}
          <span aria-hidden="true"> →</span>
        </Link>
        {month !== thisMonth ? <Link to="/site/events">Back to this month</Link> : null}
      </nav>
      {query.isPending ? (
        <LoadingNote label="events" />
      ) : query.isError ? (
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <MonthGrid month={month} events={query.data.items} />
          <section aria-labelledby="events-list">
            <h2 id="events-list" className="visually-hidden">
              Events in {monthLabel(month)}
            </h2>
            {query.data.items.length === 0 ? (
              <EmptyNote>No events are listed for {monthLabel(month)}.</EmptyNote>
            ) : (
              <ol className="site-list">
                {query.data.items.map((event) => (
                  <li key={event.id} className="site-item">
                    <div>
                      <h3>{event.title}</h3>
                      <p>
                        <time dateTime={dateOnly(event.date)}>{eventDateRange(event)}</time>
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                      {event.description ? <p>{event.description}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </>
  );
}
