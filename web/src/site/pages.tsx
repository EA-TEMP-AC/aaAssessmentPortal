import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { SITE_NAV } from "./SiteLayout";
import { buildOrgTree, type OrgTreeNode } from "./organogramTree";
import {
  fetchAllPublic,
  safeHref,
  UTILITY_BILL_CATEGORIES,
  type Grievance,
  type Linkage,
  type OfficeDocument,
  type OrgNode,
  type PoshItem,
  type PublicPerson,
  type SamplePaper,
  type TeamMember,
} from "./publicApi";
import {
  Avatar,
  EmptyNote,
  ErrorNote,
  LoadingNote,
  PagedList,
  RefLink,
} from "./parts";
import { PUBLIC_STALE_MS, SITE_NAME, usePageTitle } from "./util";

export function SiteHomePage() {
  usePageTitle("Home");
  return (
    <>
      <h1>{SITE_NAME}</h1>
      <p>
        Public information about our team, assessors, policies and upcoming events. No sign in is needed to read
        these pages.
      </p>
      <ul className="site-cards">
        {SITE_NAV.filter((item) => item.to !== "/site").map((item) => (
          <li key={item.to}>
            <Link to={item.to}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function TeamPage() {
  usePageTitle("Team");
  return (
    <>
      <h1>Our team</h1>
      <PagedList<TeamMember> slug="team-members" label="team" empty="No team members have been published yet.">
        {(items) => (
          <ul className="site-list">
            {items.map((member) => (
              <li key={member.id} className="site-item">
                <Avatar name={member.name} photoRef={member.photoRef} />
                <div>
                  <h2>{member.name}</h2>
                  <p>
                    {member.designation}
                    {member.department ? `, ${member.department}` : ""}
                  </p>
                  {member.bio ? <p>{member.bio}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PagedList>
    </>
  );
}

function OrgBranch({ nodes }: { nodes: OrgTreeNode[] }) {
  return (
    <ul className="site-tree">
      {nodes.map((node) => (
        <li key={node.id}>
          <span className="site-tree-node">
            <strong>{node.name}</strong>, {node.title}
          </span>
          {node.children.length > 0 ? <OrgBranch nodes={node.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function OrganogramPage() {
  usePageTitle("Organogram");
  const query = useQuery({
    queryKey: ["public", "organogram", "all"],
    queryFn: () => fetchAllPublic<OrgNode>("organogram"),
    staleTime: PUBLIC_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return (
    <>
      <h1>Organogram</h1>
      {query.isPending ? (
        <LoadingNote label="organogram" />
      ) : query.isError ? (
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyNote>The organogram has not been published yet.</EmptyNote>
      ) : (
        <>
          <p>Each person is listed under the person they report to.</p>
          <OrgBranch nodes={buildOrgTree(query.data.items)} />
        </>
      )}
    </>
  );
}

const PEOPLE_FILTERS = [
  { value: "", label: "All" },
  { value: "assessor", label: "Assessors" },
  { value: "proctor", label: "Proctors" },
] as const;

export function PeoplePage() {
  usePageTitle("Assessors and proctors");
  const [search, setSearch] = useSearchParams();
  const raw = search.get("kind");
  const kind = raw === "assessor" || raw === "proctor" ? raw : "";
  const choose = (value: string) => {
    const copy = new URLSearchParams();
    if (value) copy.set("kind", value);
    setSearch(copy);
  };
  return (
    <>
      <h1>Assessors and proctors</h1>
      <div role="group" aria-label="Show" className="site-filter">
        {PEOPLE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={kind === filter.value}
            className={kind === filter.value ? "site-filter-on" : undefined}
            onClick={() => choose(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <PagedList<PublicPerson>
        slug="people"
        label="assessors and proctors"
        params={{ kind: kind || undefined }}
        empty="No assessors or proctors have been published yet."
      >
        {(items) => (
          <ul className="site-list">
            {items.map((person) => (
              <li key={person.id} className="site-item">
                <Avatar name={person.name} photoRef={person.photoRef} />
                <div>
                  <h2>{person.name}</h2>
                  <p>
                    {person.roleLabel}
                    {person.sector ? ` · Sector: ${person.sector}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PagedList>
    </>
  );
}

export function SamplePapersPage() {
  usePageTitle("Sample papers");
  return (
    <>
      <h1>Sample papers</h1>
      <PagedList<SamplePaper> slug="sample-papers" label="sample papers" empty="No sample papers have been published yet.">
        {(items) => (
          <ul className="site-list">
            {items.map((paper) => (
              <li key={paper.id} className="site-item">
                <div>
                  <h2>{paper.title}</h2>
                  {paper.qualification ? (
                    <p>
                      {paper.qualification.name} ({paper.qualification.code})
                      {paper.qualification.sector ? ` · Sector: ${paper.qualification.sector}` : ""}
                    </p>
                  ) : null}
                  <p>
                    <RefLink value={paper.fileRef} label={`Open ${paper.title}`} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PagedList>
    </>
  );
}

export function IndustryLinkagesPage() {
  usePageTitle("Industry linkages");
  return (
    <>
      <h1>Industry linkages</h1>
      <PagedList<Linkage> slug="industry-linkages" label="industry linkages" empty="No industry linkages have been published yet.">
        {(items) => (
          <ul className="site-list">
            {items.map((linkage) => (
              <li key={linkage.id} className="site-item">
                <Avatar name={linkage.name} photoRef={linkage.logoRef} />
                <div>
                  <h2>{linkage.name}</h2>
                  {linkage.description ? <p>{linkage.description}</p> : null}
                  {safeHref(linkage.websiteUrl) ? (
                    <p>
                      <RefLink value={linkage.websiteUrl} label={`Visit the website of ${linkage.name}`} />
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PagedList>
    </>
  );
}

export function GrievancePage() {
  usePageTitle("Grievance procedure and contact");
  return (
    <>
      <h1>Grievance procedure and contact</h1>
      <PagedList<Grievance> slug="grievance" label="grievance procedure" empty="The grievance procedure has not been published yet.">
        {(items) => (
          <ul className="site-list">
            {items.map((entry) => (
              <li key={entry.id} className="site-item">
                <div>
                  <h2>{entry.title}</h2>
                  {entry.body ? <p className="site-body">{entry.body}</p> : null}
                  {entry.contactName || entry.contactEmail || entry.contactPhone ? (
                    <p>
                      Contact:{" "}
                      {[
                        entry.contactName,
                        entry.contactEmail ? <a key="mail" href={`mailto:${entry.contactEmail}`}>{entry.contactEmail}</a> : null,
                        entry.contactPhone ? <a key="tel" href={`tel:${entry.contactPhone.replace(/[^+\d]/g, "")}`}>{entry.contactPhone}</a> : null,
                      ]
                        .filter(Boolean)
                        .map((part, index) => (
                          <span key={index}>
                            {index > 0 ? " · " : ""}
                            {part}
                          </span>
                        ))}
                    </p>
                  ) : null}
                  <p>
                    <RefLink value={entry.fileRef} label="Open the procedure document" />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PagedList>
    </>
  );
}

export function PoshPage() {
  usePageTitle("POSH policy and committee");
  const query = useQuery({
    queryKey: ["public", "posh", "all"],
    queryFn: () => fetchAllPublic<PoshItem>("posh"),
    staleTime: PUBLIC_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const items = query.data?.items ?? [];
  const policies = items.filter((item) => item.kind === "policy");
  const members = items.filter((item) => item.kind === "committee_member");
  return (
    <>
      <h1>POSH policy and committee</h1>
      {query.isPending ? (
        <LoadingNote label="POSH information" />
      ) : query.isError ? (
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyNote>The POSH policy and committee have not been published yet.</EmptyNote>
      ) : (
        <>
          <section aria-labelledby="posh-policy">
            <h2 id="posh-policy">Policy</h2>
            {policies.length === 0 ? (
              <EmptyNote>No policy has been published yet.</EmptyNote>
            ) : (
              <ul className="site-list">
                {policies.map((policy) => (
                  <li key={policy.id} className="site-item">
                    <div>
                      <h3>{policy.title}</h3>
                      {policy.body ? <p className="site-body">{policy.body}</p> : null}
                      <p>
                        <RefLink value={policy.fileRef} label={`Open ${policy.title}`} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="posh-committee">
            <h2 id="posh-committee">Committee</h2>
            {members.length === 0 ? (
              <EmptyNote>No committee members have been published yet.</EmptyNote>
            ) : (
              <ul className="site-list">
                {members.map((member) => (
                  <li key={member.id} className="site-item">
                    <div>
                      <h3>{member.memberName ?? member.title}</h3>
                      <p>{[member.memberRole, member.memberName ? member.title : null].filter(Boolean).join(" · ")}</p>
                      {member.body ? <p className="site-body">{member.body}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  ownership: "Ownership",
  lease: "Lease",
  telephone_bill: "Telephone bill",
  internet_bill: "Internet bill",
  electricity_bill: "Electricity bill",
  other: "Other",
};

export function OfficeDocumentsPage() {
  usePageTitle("Office documents");
  return (
    <>
      <h1>Office documents</h1>
      <PagedList<OfficeDocument> slug="office-documents" label="office documents" empty="No office documents have been published yet.">
        {(items) => (
          <ul className="site-list">
            {items.map((doc) => {
              // Utility bills are never linked, even if the response carried a reference.
              const proofOnly = doc.proofOnFile === true || UTILITY_BILL_CATEGORIES.has(doc.category);
              return (
                <li key={doc.id} className="site-item">
                  <div>
                    <h2>{doc.title}</h2>
                    <p>{CATEGORY_LABELS[doc.category] ?? doc.category}</p>
                    {doc.note ? <p>{doc.note}</p> : null}
                    <p>
                      {proofOnly ? (
                        <strong>Proof on file</strong>
                      ) : (
                        <RefLink value={doc.fileRef} label={`Open ${doc.title}`} />
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PagedList>
    </>
  );
}
