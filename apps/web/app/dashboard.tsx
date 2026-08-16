"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchCommercialCapabilities,
} from "@/lib/commercial-capabilities";
import { fetchCommercialSession } from "@/lib/commercial-session";
import type {
  CommercialCapabilitiesResponse,
  CommercialCapability,
  CommercialSessionResponse,
} from "@spiderbyte/protocol";

import { WorkspaceShell } from "./workspace-shell";

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
      <WorkspaceApp />
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
          <span className="button button-secondary">Local preview</span>
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
            <a className="button button-primary" href="#platform">
              Open the workspace <span aria-hidden="true">→</span>
            </a>
            <a className="button button-secondary" href="#governance">
              See how it works
            </a>
          </div>
          <div className="hero-note">
            <span className="status-dot" aria-hidden="true" />
            Local-first foundation · hosted path configuration-gated
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
  const firstName = "Preview user";

  return (
    <div className="app-frame collaboration-frame">
      <header className="app-header">
        <Brand />
        <div className="header-actions" style={{ marginLeft: "auto" }}>
          <span className="button button-secondary">Local preview</span>
        </div>
      </header>

      <div className="app-main">
        <aside className="app-sidebar">
          <div className="workspace-switcher">
            <span className="eyebrow">Workspace</span>
            <div style={{ marginTop: "0.55rem", fontSize: "0.82rem", fontWeight: 700 }}>
              Personal workspace
            </div>
          </div>
          <nav className="app-nav" aria-label="Workspace navigation">
            {navItems.map((item) => (
              <button
                className={activeView === item.id ? "active" : ""}
                key={item.id}
                type="button"
                onClick={() => { setActiveView(item.id); }}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="app-content">
          {activeView === "billing" ? (
            <BillingView organizationName="Personal workspace" />
          ) : (
            <WorkspaceShell firstName={firstName} />
          )}
        </section>
      </div>
    </div>
  );
}

function BillingView({ organizationName }: { organizationName?: string }) {
  const [commercial, setCommercial] = useState<CommercialCapabilitiesResponse>();
  const [commercialSession, setCommercialSession] = useState<CommercialSessionResponse>();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCommercialCapabilities(), fetchCommercialSession()]).then(([capabilities, session]) => {
      if (cancelled) return;
      setCommercial(capabilities);
      setCommercialSession(session);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const billing = findCapability(commercial, "billing");
  const entitlements = findCapability(commercial, "entitlements");
  const platformBinding = findCapability(commercial, "platform_identity_binding");
  const projectWorkspaceBinding = findCapability(commercial, "platform_project_workspace_binding");

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
            <p>Commercial billing is disabled in local preview mode; SpiderByte remains the authority for usage and entitlements.</p>
          </div>
          <span className={`status-dot commercial-status-dot ${billing?.availability ?? "not_configured"}`} aria-label={`Billing ${billing?.availability ?? "status unavailable"}`} />
        </div>
        <div className="commercial-capability-grid" aria-live="polite">
          <CommercialCapabilityCard label="Billing enforcement" capability={billing} />
          <CommercialCapabilityCard label="Entitlements" capability={entitlements} />
          <CommercialCapabilityCard label="Platform tenant binding" capability={platformBinding} />
          <CommercialCapabilityCard label="Project/workspace mapping" capability={projectWorkspaceBinding} />
        </div>
        <div className="commercial-session-status" aria-live="polite">
          <span className="eyebrow">Hosted identity synchronization</span>
          <strong>{commercialSession === undefined ? "Unavailable" : "Synchronized"}</strong>
          <p>
            {commercialSession === undefined
              ? "The hosted commercial boundary has not returned an authorized tenant projection."
              : `${commercialSession.organizations.length} authorized organization${commercialSession.organizations.length === 1 ? "" : "s"} are synchronized for this session.`}
          </p>
        </div>
      </div>
    </div>
  );
}

function CommercialCapabilityCard({
  label,
  capability,
}: {
  label: string;
  capability?: CommercialCapability;
}) {
  return (
    <div className="commercial-capability-card">
      <span className="eyebrow">{label}</span>
      <strong>{capabilityLabel(capability?.availability)}</strong>
      <p>{capability?.reason ?? "Waiting for the commercial capability boundary."}</p>
    </div>
  );
}

function findCapability(
  snapshot: CommercialCapabilitiesResponse | undefined,
  name: string,
): CommercialCapability | undefined {
  return snapshot?.capabilities.find((capability) => capability.capability === name);
}

function capabilityLabel(availability: CommercialCapability["availability"] | undefined): string {
  if (availability === undefined) return "Status unavailable";
  switch (availability) {
    case "available": return "Available";
    case "not_included": return "Not included";
    case "not_implemented": return "Not implemented";
    case "temporarily_unavailable": return "Temporarily unavailable";
    case "not_configured": return "Not configured";
  }
  return "Status unavailable";
}
