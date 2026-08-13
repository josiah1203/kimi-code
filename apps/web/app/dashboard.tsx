"use client";

import {
  ClerkLoaded,
  ClerkLoading,
  OrganizationSwitcher,
  PricingTable,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useOrganization,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";
import { useState, type MouseEvent } from "react";

type AppView = "overview" | "workspaces" | "usage" | "billing";

const navItems: readonly { id: AppView; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "◒" },
  { id: "workspaces", label: "Workspaces", icon: "⌘" },
  { id: "usage", label: "Usage & limits", icon: "↗" },
  { id: "billing", label: "Billing", icon: "$" },
];

export function Dashboard() {
  return (
    <main className="site-shell">
      <ClerkLoading>
        <LoadingScreen />
      </ClerkLoading>
      <ClerkLoaded>
        <Show when="signed-out">
          <LandingScreen />
        </Show>
        <Show when="signed-in">
          <WorkspaceApp />
        </Show>
      </ClerkLoaded>
    </main>
  );
}

function LoadingScreen() {
  return (
    <div className="site-shell" aria-label="Loading SpiderByte">
      <header className="marketing-header">
        <Brand />
      </header>
      <section className="hero">
        <div>
          <span className="eyebrow">Initializing workspace</span>
          <h1>Preparing your control plane.</h1>
        </div>
      </section>
    </div>
  );
}

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="SpiderByte home">
      <span className="brand-mark">SB</span>
      SPIDERBYTE
    </Link>
  );
}

function LandingScreen() {
  return (
    <>
      <header className="marketing-header">
        <Brand />
        <nav className="marketing-nav" aria-label="Primary navigation">
          <a href="#platform">Platform</a>
          <a href="#governance">Governance</a>
          <a href="#billing">Billing</a>
        </nav>
        <div className="header-actions">
          <SignInButton mode="modal">
            <button className="button button-secondary" type="button">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="button button-primary" type="button">
              Start building <span aria-hidden="true">↗</span>
            </button>
          </SignUpButton>
        </div>
      </header>

      <section className="hero" id="platform">
        <div>
          <span className="eyebrow">The governed agent platform</span>
          <h1>
            Build with <em>clarity.</em>
          </h1>
          <p className="hero-copy">
            A calm operating layer for agent workspaces, data, and ML. Keep
            execution visible, policy close, and every decision accountable.
          </p>
          <div className="hero-actions">
            <SignUpButton mode="modal">
              <button className="button button-primary" type="button">
                Create your workspace <span aria-hidden="true">→</span>
              </button>
            </SignUpButton>
            <a className="button button-secondary" href="#governance">
              See how it works
            </a>
          </div>
          <div className="hero-note">
            <span className="status-dot" aria-hidden="true" />
            Local-first foundation · hosted control plane ready
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="orb" />
          <div className="floating-card secondary">
            <span className="mini-label">Policy coverage</span>
            <strong>100%</strong>
            <div className="meter"><span /></div>
          </div>
          <div className="floating-card primary">
            <span className="mini-label">Active workspace</span>
            <strong>Northstar / main</strong>
            <div className="health-card">
              <span>All systems healthy</span>
              <span className="status-dot" />
            </div>
          </div>
        </div>
      </section>

      <section className="feature-strip" id="governance">
        <FeatureCard
          eyebrow="01 / Execute"
          title="One workspace for the run."
          body="Sessions, artifacts, providers, and models stay connected from prompt to result."
        />
        <FeatureCard
          eyebrow="02 / Govern"
          title="Controls where work happens."
          body="Budgets, permissions, approvals, and audit trails are part of the runtime."
        />
        <FeatureCard
          eyebrow="03 / Scale"
          title="A commercial path when ready."
          body="Organizations, usage, plans, and entitlements grow with your team—not around it."
        />
      </section>

      <div id="billing" aria-hidden="true" />
    </>
  );
}

function FeatureCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <article className="feature-item">
      <span className="eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function WorkspaceApp() {
  const [activeView, setActiveView] = useState<AppView>("overview");
  const { user } = useUser();
  const { organization } = useOrganization();
  const firstName = user?.firstName ?? user?.username ?? "there";

  return (
    <div className="app-frame">
      <header className="app-header">
        <Brand />
        <div className="header-actions" style={{ marginLeft: "auto" }}>
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/"
            afterSelectOrganizationUrl="/"
            afterSelectPersonalUrl="/"
            appearance={{ elements: { rootBox: { minWidth: "11rem" } } }}
          />
          <Link className="button button-secondary" href="/account">
            Account
          </Link>
          <UserButton />
        </div>
      </header>

      <div className="app-main">
        <aside className="app-sidebar">
          <div className="workspace-switcher">
            <span className="eyebrow">Workspace</span>
            <div style={{ marginTop: "0.55rem", fontSize: "0.82rem", fontWeight: 700 }}>
              {organization?.name ?? "Personal workspace"}
            </div>
          </div>
          <nav className="app-nav" aria-label="Workspace navigation">
            {navItems.map((item) => (
              <button
                className={activeView === item.id ? "active" : ""}
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="app-content">
          {activeView === "billing" ? (
            <BillingView organizationName={organization?.name} />
          ) : (
            <OverviewView firstName={firstName} view={activeView} />
          )}
        </section>
      </div>
    </div>
  );
}

function OverviewView({ firstName, view }: { firstName: string; view: AppView }) {
  const copy: Record<Exclude<AppView, "billing">, { title: string; body: string }> = {
    overview: { title: `Good morning, ${firstName}.`, body: "Your governed workspace is ready for its next run." },
    workspaces: { title: "Your workspaces.", body: "Keep projects, sessions, and runtime boundaries organized." },
    usage: { title: "Usage & limits.", body: "Make resource decisions visible before they become surprises." },
  };
  const selected = copy[view === "billing" ? "overview" : view];

  return (
    <>
      <div className="content-heading">
        <div>
          <span className="eyebrow">Control plane / {view}</span>
          <h1>{selected.title}</h1>
          <p>{selected.body}</p>
        </div>
        <Link className="button button-primary" href="/account">
          Manage account <span aria-hidden="true">↗</span>
        </Link>
      </div>

      <div className="dashboard-grid">
        <article className="panel panel-wide">
          <span className="eyebrow">Runtime snapshot</span>
          <h2>Northstar workspace</h2>
          <div className="metric-row">
            <Metric label="Sessions today" value="24" />
            <Metric label="Policy checks" value="100%" />
            <Metric label="Artifacts" value="1,284" />
          </div>
          <div className="health-card">
            <span><span className="status-dot" /> &nbsp;Agent Core is responding normally</span>
            <span>Updated just now</span>
          </div>
        </article>

        <article className="panel panel-side">
          <span className="eyebrow">Plan status</span>
          <h2>Foundation</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.55 }}>
            Your workspace includes local execution, policy controls, and a path to hosted billing.
          </p>
          <Link className="quiet-link" href="#billing" onClick={(event: MouseEvent<HTMLAnchorElement>) => event.preventDefault()}>
            View plan options →
          </Link>
        </article>

        <article className="panel panel-wide">
          <span className="eyebrow">Recent activity</span>
          <ul className="activity-list">
            <Activity title="Policy bundle refreshed" detail="main · 2 minutes ago" />
            <Activity title="Artifact retention check passed" detail="northstar-data · 18 minutes ago" />
            <Activity title="New session completed" detail="agent/main · 43 minutes ago" />
          </ul>
        </article>

        <article className="panel panel-side">
          <span className="eyebrow">Next step</span>
          <h2>Invite your team.</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.55 }}>
            Organizations make membership, roles, and billing explicit.
          </p>
          <Link className="button button-secondary" href="/organization" style={{ marginTop: "0.6rem" }}>
            Open organization settings
          </Link>
        </article>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="mini-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Activity({ title, detail }: { title: string; detail: string }) {
  return (
    <li>
      <span className="status-dot" aria-hidden="true" />
      <span><b>{title}</b>{detail}</span>
    </li>
  );
}

function BillingView({ organizationName }: { organizationName?: string }) {
  return (
    <div className="billing-frame">
      <div className="content-heading">
        <div>
          <span className="eyebrow">Control plane / billing</span>
          <h1>Plans that stay legible.</h1>
          <p>
            {organizationName ?? "Your personal workspace"} can choose a plan,
            manage seats, and keep entitlements close to execution.
          </p>
        </div>
      </div>
      <div className="billing-card">
        <div className="billing-card-header">
          <div>
            <span className="eyebrow">Subscription plans</span>
            <p>Powered by Clerk Billing; enforced by SpiderByte’s commercial control plane.</p>
          </div>
          <span className="status-dot" aria-label="Billing connected" />
        </div>
        <div className="pricing-wrap">
          <PricingTableForCurrentPayer />
        </div>
      </div>
    </div>
  );
}

function PricingTableForCurrentPayer() {
  const { organization } = useOrganization();

  return (
    <div className="clerk-host">
      <PricingTable
        for={organization ? "organization" : "user"}
        newSubscriptionRedirectUrl="/"
      />
    </div>
  );
}
