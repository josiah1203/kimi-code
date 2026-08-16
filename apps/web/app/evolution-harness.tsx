"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import styles from "./evolution-harness.module.css";

type InspectorTab = "what" | "built";

type WorkflowItem = {
  readonly id: string;
  readonly marker: string;
  readonly label: string;
  readonly count: number;
  readonly child?: string;
};

const workflowGroups: readonly {
  readonly label: string;
  readonly items: readonly WorkflowItem[];
}[] = [
  {
    label: "THE EVOLUTION LOOP",
    items: [
      { id: "strategy", marker: "A", label: "STRATEGY ARCHIVE", count: 2 },
      { id: "parent", marker: "B", label: "PARENT SELECTION", count: 1 },
      { id: "doctrine", marker: "C", label: "DOCTRINE WRITERS", count: 2, child: "S1  DOCTRINE-WRITING MODEL" },
      { id: "games", marker: "E", label: "EVALUATION GAMES", count: 1, child: "H  RATING" },
      { id: "recording", marker: "C", label: "RECORDING & WRITE-UP", count: 2, child: "S2  CARD-WRITING MODEL" },
      { id: "filing", marker: "F", label: "EMBEDDING & FILING", count: 1 },
    ],
  },
  {
    label: "SUPPORTING THE LOOP",
    items: [
      { id: "driver", marker: "OP", label: "MODEL-CALL DRIVER", count: 1 },
      { id: "library", marker: "V", label: "SHARED LIBRARY", count: 2, child: "S4  LIBRARY-EDITING MODEL" },
      { id: "reserve", marker: "V", label: "RESERVE POOL", count: 1 },
      { id: "progress", marker: "V", label: "PROGRESS MEASUREMENT", count: 3 },
    ],
  },
  {
    label: "THE GAME",
    items: [
      { id: "engine", marker: "G", label: "GAME ENGINE", count: 1 },
      { id: "api", marker: "G", label: "DOCTRINE API", count: 1 },
    ],
  },
  {
    label: "WHAT COMES OUT",
    items: [
      { id: "export", marker: "G", label: "STANDALONE EXPORT", count: 1 },
    ],
  },
];

const inspectorCopy: Record<string, { readonly title: string; readonly summary: string; readonly body: readonly string[] }> = {
  strategy: {
    title: "Strategy Archive",
    summary: "A durable shelf for the strategies that have already earned another round.",
    body: [
      "Every accepted strategy is kept beside its evidence, rating, and the exact run that produced it.",
      "The archive is the memory of the system: readable by people, addressable by agents, and safe to replay.",
    ],
  },
  parent: {
    title: "Parent Selection",
    summary: "A measured choice of what to carry into the next evaluation.",
    body: [
      "Selection favors evidence over novelty. A parent is chosen from the archive with its constraints and lineage intact.",
      "The next run starts from a known state instead of a blank prompt.",
    ],
  },
  doctrine: {
    title: "Doctrine Writers",
    summary: "Where a promising strategy becomes an executable doctrine.",
    body: [
      "This repository is a turn-based harness for strategy programs. A model writes a plan, the game plays it, and the resulting evidence becomes a rating and a written description.",
      "The loop is visible because every hand-off is named: pick a parent, write a new doctrine, play it, rate it, write it up, and file it back into the archive.",
      "The doctrine writer is the first model in that loop. Its job is to make the next move explicit enough to measure.",
    ],
  },
  games: {
    title: "Evaluation Games",
    summary: "A bounded environment for finding out whether a doctrine survives contact with reality.",
    body: [
      "Each game gives the doctrine the same starting conditions and records the choices it makes.",
      "Runs are comparable because the harness keeps the rules, population, and scoring surface stable.",
    ],
  },
  recording: {
    title: "Recording & Write-Up",
    summary: "The evidence layer that turns a run into a durable decision.",
    body: [
      "A completed game produces a card: what happened, what worked, what failed, and what should change next time.",
      "The card-writing model compresses the run without losing the measurements that make it auditable.",
    ],
  },
  filing: {
    title: "Embedding & Filing",
    summary: "The return path from finished experiment to searchable memory.",
    body: [
      "Cards are embedded, indexed, and filed beside their source run so later selection can use both semantic similarity and hard results.",
    ],
  },
  driver: {
    title: "Model-Call Driver",
    summary: "The narrow boundary between a doctrine step and a configured provider.",
    body: [
      "Provider selection, usage, cancellation, and trace metadata stay outside the game rules.",
      "The driver can be local or customer-managed; the harness only receives the bounded result.",
    ],
  },
  library: {
    title: "Shared Library",
    summary: "Common instructions and reusable primitives for every strategy run.",
    body: [
      "Library edits are versioned inputs, never hidden prompt magic. A run can point back to the exact library state it used.",
    ],
  },
  reserve: {
    title: "Reserve Pool",
    summary: "A controlled source of alternative strategies when the main line stalls.",
    body: [
      "The reserve stays outside the active loop until the measurement layer asks for another angle.",
    ],
  },
  progress: {
    title: "Progress Measurement",
    summary: "The scoreboard for whether the loop is actually improving.",
    body: [
      "Progress is recorded as a sequence of comparable results rather than a single confidence score.",
    ],
  },
  engine: {
    title: "Game Engine",
    summary: "The deterministic surface where a doctrine is executed and scored.",
    body: [
      "The engine owns the rules of the game and emits the events that the rest of the loop can inspect.",
    ],
  },
  api: {
    title: "Doctrine API",
    summary: "The typed contract between a strategy program and its environment.",
    body: [
      "The API keeps the program surface small, explicit, and replayable across local runs.",
    ],
  },
  export: {
    title: "Standalone Export",
    summary: "A portable result that can leave the harness without losing its provenance.",
    body: [
      "Exports include the doctrine, measurements, run identity, and the library versions required to understand the result.",
    ],
  },
};

const builtRows = [
  ["RUN CONTRACT", "run → attempt → action → result"],
  ["MODEL ROLES", "4 bounded provider calls"],
  ["STATE", "durable, replayable, inspectable"],
  ["OUTPUT", "cards + measurements + lineage"],
] as const;

function allWorkflowItems(): readonly WorkflowItem[] {
  return workflowGroups.flatMap((group) => group.items);
}

function markText(text: string): React.ReactNode {
  const chunks = text.split(/(loop|play it|breeds strategy programs|measurement problem|How it is built|Condition|goes inside)/g);
  return chunks.map((chunk, index) => {
    const isMarked = ["loop", "play it", "breeds strategy programs", "measurement problem", "How it is built", "Condition", "goes inside"].includes(chunk);
    return isMarked ? <mark key={`${chunk}-${index}`}>{chunk}</mark> : chunk;
  });
}

export function EvolutionHarness() {
  const [activeId, setActiveId] = useState("doctrine");
  const [activeTab, setActiveTab] = useState<InspectorTab>("what");
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState("READY · LOCAL HARNESS");

  const activeItem = useMemo(
    () => allWorkflowItems().find((item) => item.id === activeId) ?? allWorkflowItems()[0],
    [activeId],
  );
  const activeCopy = inspectorCopy[activeId] ?? inspectorCopy.doctrine;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % 6);
    }, 850);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    setNotice(`RUNNING · STEP ${String(step + 1).padStart(2, "0")} / 06`);
  }, [isPlaying, step]);

  function selectWorkflow(item: WorkflowItem) {
    setActiveId(item.id);
    setActiveTab("what");
    setNotice(`INSPECTING · ${item.label}`);
  }

  function toggleFlow() {
    setIsPlaying((current) => {
      const next = !current;
      setNotice(next ? "RUNNING · STEP 01 / 06" : "PAUSED · LOCAL HARNESS");
      return next;
    });
  }

  function traceStep() {
    setIsPlaying(false);
    setStep((current) => (current + 1) % 6);
    setNotice(`TRACE · STEP ${String((step + 1) % 6 + 1).padStart(2, "0")} / 06`);
  }

  function resetView() {
    setZoom(1);
    setStep(0);
    setIsPlaying(false);
    setNotice("RESET · LOCAL HARNESS");
  }

  return (
    <main className={styles.harness}>
      <header className={styles.topbar}>
        <div className={styles.repoCell}>
          <span className={styles.microLabel}>REPOSITORY</span>
          <strong>kimi · spiderbyte-rewrite</strong>
        </div>
        <Metric label="MODEL ROLES" value="4" />
        <Metric label="RUNS" value="18 · 8 in era 4" />
        <Metric label="DOCTRINES BRED" value="582 distinct" />
        <Metric label="GAMES ON RECORD" value="41,340" />
        <Metric label="ENGINES" value="2 — one not switched on" wide />
        <div className={styles.topActions}>
          <button className={styles.topButton} type="button" onClick={toggleFlow}>
            <span aria-hidden="true">›</span> {isPlaying ? "PAUSE FLOW" : "RESUME THE FLOW"}
          </button>
          <button className={styles.topButton} type="button" onClick={traceStep}>TRACE ONE STEP</button>
          <button className={styles.topButton} type="button" onClick={resetView}>RESET VIEW</button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.leftRail} aria-label="Evolution loop navigation">
          <div className={styles.railIntro}>
            <span className={styles.microLabel}>THE SYSTEM</span>
            <span className={styles.railHint}>A MAP OF THE ACTIVE LOOP</span>
          </div>
          {workflowGroups.map((group) => (
            <section className={styles.railGroup} key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map((item) => (
                <div className={styles.railItemWrap} key={item.id}>
                  <button
                    className={`${styles.railItem} ${activeId === item.id ? styles.railItemActive : ""}`}
                    type="button"
                    onClick={() => selectWorkflow(item)}
                    aria-current={activeId === item.id ? "page" : undefined}
                  >
                    <span className={styles.itemMarker}>{item.marker}</span>
                    <span className={styles.itemLabel}>{item.label}</span>
                    <span className={styles.itemCount}>{item.count}</span>
                  </button>
                  {item.child ? <div className={styles.railChild}>{item.child}</div> : null}
                </div>
              ))}
            </section>
          ))}
        </aside>

        <section className={styles.mapColumn} aria-label="Evolution map">
          <div className={styles.mapControls}>
            <button type="button" onClick={() => setZoom((current) => Math.min(1.22, Number((current + 0.08).toFixed(2))))} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => setZoom((current) => Math.max(0.78, Number((current - 0.08).toFixed(2))))} aria-label="Zoom out">−</button>
          </div>
          <div className={styles.mapViewport}>
            <div className={styles.mapFrame} style={{ transform: `scale(${zoom * 1.12})` }}>
              <Image
                src="/evolution-harness-diagram.png"
                alt="Isometric map of connected strategy, game, and archive components"
                fill
                priority
                sizes="(max-width: 900px) 100vw, 70vw"
                className={styles.mapImage}
              />
            </div>
          </div>
          <div className={styles.mapFooter}>
            <span>{notice}</span>
            <span>ZOOM {Math.round(zoom * 100)}%</span>
            <span>DRAG TO PAN · SCROLL TO ZOOM</span>
          </div>
        </section>

        <aside className={styles.inspector} aria-label="System explanation">
          <div className={styles.inspectorTabs} role="tablist" aria-label="Inspector views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "what"}
              className={activeTab === "what" ? styles.tabActive : ""}
              onClick={() => setActiveTab("what")}
            >
              WHAT IT DOES
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "built"}
              className={activeTab === "built" ? styles.tabActive : ""}
              onClick={() => setActiveTab("built")}
            >
              HOW IT&apos;S BUILT
            </button>
          </div>
          {activeTab === "what" ? (
            <div className={styles.inspectorContent} role="tabpanel">
              <span className={styles.microLabel}>RIVERS OF EMPIRE</span>
              <h1>The Evolution Harness</h1>
              <p className={styles.lede}>{activeCopy.summary}</p>
              <InspectorSection title={`WHAT THIS IS · ${activeItem?.label ?? "DOCTRINE WRITERS"}`}>
                {activeCopy.body.map((paragraph) => <p key={paragraph}>{markText(paragraph)}</p>)}
              </InspectorSection>
              <InspectorSection title="HOW TO READ IT">
                <p>Hover anything for a plain description; the <mark>How it&apos;s built</mark> tab gives the implementation, and <mark>Condition</mark> lists what is currently wrong with it.</p>
              </InspectorSection>
              <div className={styles.selectedCard}>
                <span className={styles.microLabel}>SELECTED COMPONENT</span>
                <strong>{activeItem?.label}</strong>
                <span>{activeItem?.count} linked structure{activeItem?.count === 1 ? "" : "s"} · step {step + 1} of 6</span>
              </div>
            </div>
          ) : (
            <div className={styles.inspectorContent} role="tabpanel">
              <span className={styles.microLabel}>IMPLEMENTATION SURFACE</span>
              <h1>The Harness Contract</h1>
              <p className={styles.lede}>A small, inspectable runtime for evolving strategies without hiding the evidence.</p>
              <div className={styles.builtTable}>
                {builtRows.map(([label, value]) => (
                  <div className={styles.builtRow} key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <InspectorSection title="CURRENT CONDITION">
                <p><mark>1 engine is not switched on.</mark> The local path is available; hosted execution remains an explicit adapter boundary.</p>
                <p>Every run keeps its attempt, action, result, and artifact references so a future step can be replayed instead of guessed.</p>
              </InspectorSection>
              <InspectorSection title="THE LOOP">
                <p>Archive → select → write → play → rate → record → file → archive.</p>
              </InspectorSection>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value, wide = false }: { readonly label: string; readonly value: string; readonly wide?: boolean }) {
  return (
    <div className={`${styles.metric} ${wide ? styles.metricWide : ""}`}>
      <span className={styles.microLabel}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InspectorSection({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className={styles.inspectorSection}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
