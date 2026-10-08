import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Ban,
  Check,
  Clock3,
  FlaskConical,
  KeyRound,
  Link2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "recent-tx-safe-guard — Onchain policy for self-custody" },
      {
        name: "description",
        content:
          "A one-Safe vault with bounded instant spending, step-up approval, and cancellable delayed withdrawals.",
      },
      {
        property: "og:title",
        content: "recent-tx-safe-guard — Onchain policy for self-custody",
      },
      {
        property: "og:description",
        content:
          "A one-Safe vault with bounded instant spending, step-up approval, and cancellable delayed withdrawals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <main className="landing-page overflow-hidden">
      <LandingHeader />
      <Hero />
      <section
        className="landing-container landing-section-grid"
        aria-label="Project overview"
      >
        <InfoPanel
          eyebrow="Threat model"
          icon={<Shield className="size-5" aria-hidden />}
          title="Realistic risks. Practical mitigations."
          copy="Designed for people and teams facing compromised devices, lost keys, rushed approvals, malicious interfaces, and human error."
          items={[
            "Stolen or phished primary key",
            "Rushed large transactions",
            "Malicious dApps and approvals",
            "Single point of failure",
          ]}
        />
        <PolicyPanel />
        <InfoPanel
          eyebrow="What is denied by default"
          icon={<Ban className="size-5" aria-hidden />}
          title="High-risk actions are blocked unless explicitly allowed."
          copy="The fast path stays intentionally narrow. Unknown contracts and dangerous calls do not become spendable just because a signature is valid."
          items={[
            "Transactions above the instant limit Y",
            "Unknown or unapproved contracts",
            "Approvals, Permit2, batches, and delegate calls",
            "Policy bypass attempts",
          ]}
          tone="danger"
        />
        <InfoPanel
          eyebrow="Designed for onboarding"
          icon={<Users className="size-5" aria-hidden />}
          title="A safer starting point for real users."
          copy="Give people familiar signing with guardrails from day one: simple daily limits, stronger approval for larger actions, and time to cancel."
          items={[
            "Passkey-first everyday signing",
            "Built-in guardrails from day one",
            "Configured secondary signer",
            "Grows with the user",
          ]}
          tone="success"
        />
      </section>
      <section
        className="landing-container landing-architecture"
        id="how-it-works"
      >
        <div className="section-heading">
          <p className="eyebrow">Built as a security core</p>
          <h2>One Safe. Multiple safeguards.</h2>
          <p>
            Convenient when the transaction is ordinary. Deliberate when the
            consequences are larger.
          </p>
        </div>
        <div className="architecture-notes">
          <Note
            icon={<KeyRound />}
            title="Passkey"
            copy="Primary signer for everyday transfers."
          />
          <Note
            icon={<Users />}
            title="Secondary signer"
            copy="Configured co-signer for step-up and delayed paths."
          />
          <Note
            icon={<SlidersHorizontal />}
            title="TieredSpendingGuard"
            copy="Enforces limits and allowed call shapes onchain."
          />
          <Note
            icon={<Clock3 />}
            title="Delay Z"
            copy="Creates a mandatory cancellation window for larger actions."
          />
        </div>
      </section>
      <LandingFooter />
    </main>
  );
}

function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="landing-container flex items-center justify-between gap-6">
        <a
          href="#top"
          className="brand-mark"
          aria-label="recent-tx-safe-guard home"
        >
          <ShieldCheck className="size-5 text-violet-300" aria-hidden />
          <span>recent-tx-safe-guard</span>
          <small>simple rules. safer ownership.</small>
        </a>
        <Link
          to="/onboarding"
          className="landing-button landing-button-primary hidden sm:inline-flex"
        >
          Try the testnet <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="landing-container hero-grid" id="top">
      <div className="hero-copy">
        <p className="hero-kicker">One Safe. Onchain policy.</p>
        <h1>
          A vault whose policy is <span>enforced onchain.</span>
        </h1>
        <p className="hero-description">
          recent-tx-safe-guard is a one-Safe vault with a clear transaction
          policy. Everyday actions are fast. Larger actions are delayed. Your
          assets, better protected.
        </p>
        <div className="hero-actions">
          <Link
            to="/onboarding"
            className="landing-button landing-button-primary"
          >
            Try the testnet <ArrowRight className="size-4" aria-hidden />
          </Link>
          <a
            href="#policy-lanes"
            className="landing-button landing-button-secondary"
          >
            <Link2 className="size-4" aria-hidden /> Read the policy
          </a>
        </div>
        <div className="hero-proof">
          <span>
            <Check /> Onchain policy
          </span>
          <span>
            <Check /> Simple UX
          </span>
          <span>
            <Check /> Testnet research
          </span>
        </div>
      </div>
      <SystemDiagram />
    </section>
  );
}

function SystemDiagram() {
  return (
    <div
      className="system-diagram"
      aria-label="System diagram showing the Safe, signers, guard, and delay"
    >
      <div className="diagram-label">
        System diagram <span>one vault. multiple safeguards.</span>
      </div>
      <div className="diagram-layout">
        <svg
          className="diagram-connections"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <marker
              id="diagram-arrow-blue"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path
                d="M0,0 L7,3.5 L0,7"
                fill="none"
                stroke="#55b4ff"
                strokeWidth="1.2"
              />
            </marker>
            <marker
              id="diagram-arrow-green"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path
                d="M0,0 L7,3.5 L0,7"
                fill="none"
                stroke="#53e28e"
                strokeWidth="1.2"
              />
            </marker>
          </defs>
          <path
            className="connection-blue"
            d="M25 31 C32 31, 34 38, 42 42"
            markerEnd="url(#diagram-arrow-blue)"
          />
          <path
            className="connection-blue"
            d="M25 69 C32 69, 34 62, 42 58"
            markerEnd="url(#diagram-arrow-blue)"
          />
          <path
            className="connection-green"
            d="M58 42 C66 38, 68 31, 75 31"
            markerEnd="url(#diagram-arrow-green)"
          />
          <path
            className="connection-green"
            d="M58 58 C66 62, 68 69, 75 69"
            markerEnd="url(#diagram-arrow-green)"
          />
        </svg>
        <span className="diagram-annotation annotation-proposes">
          Proposes tx
        </span>
        <span className="diagram-annotation annotation-cosigns">
          Co-signs (1-of-2)
        </span>
        <span className="diagram-annotation annotation-checks">
          Checks policy
        </span>
        <span className="diagram-annotation annotation-delay">
          Enforces delay
        </span>
        <div className="diagram-column">
          <DiagramNode
            icon={<KeyRound />}
            title="Passkey"
            copy="Primary signer"
          />
          <DiagramNode
            icon={<Users />}
            title="Secondary signer"
            copy="Configured co-signer"
          />
        </div>
        <div className="safe-node">
          <ShieldCheck className="size-8 text-emerald-300" />
          <strong>Safe</strong>
          <span>One vault</span>
        </div>
        <div className="diagram-column">
          <DiagramNode
            icon={<ShieldCheck />}
            title="TieredSpendingGuard"
            copy="Checks policy"
            accent="green"
          />
          <DiagramNode
            icon={<Clock3 />}
            title="Delay Z"
            copy="Enforces delay"
            accent="violet"
          />
        </div>
      </div>
      <div className="legend">
        <span>Legend</span>
        <b className="legend-x">X</b>
        <em>base limit</em>
        <b className="legend-y">Y</b>
        <em>instant limit</em>
        <b className="legend-z">Z</b>
        <em>mandatory delay</em>
      </div>
    </div>
  );
}

function DiagramNode({
  icon,
  title,
  copy,
  accent = "blue",
}: {
  icon: ReactNode;
  title: string;
  copy: string;
  accent?: string;
}) {
  return (
    <div className={`diagram-node accent-${accent}`}>
      <span className="diagram-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
    </div>
  );
}

function InfoPanel({
  eyebrow,
  icon,
  title,
  copy,
  items,
  tone = "default",
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
  copy: string;
  items: string[];
  tone?: "default" | "danger" | "success";
}) {
  return (
    <article
      className={`info-panel tone-${tone}`}
      id={eyebrow === "Threat model" ? "threat-model" : undefined}
    >
      <div className="panel-eyebrow">
        {icon}
        <span>{eyebrow}</span>
      </div>
      <h2>{title}</h2>
      <p>{copy}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Check className="size-4" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

function PolicyPanel() {
  return (
    <article className="info-panel policy-panel" id="policy-lanes">
      <div className="panel-eyebrow">
        <SlidersHorizontal className="size-5" aria-hidden />
        <span>Policy lanes</span>
      </div>
      <h2>Clear rules for different transaction sizes.</h2>
      <div className="policy-list">
        <PolicyRow
          label="≤ X"
          title="Base lane"
          copy="Passkey-only everyday spending"
          color="blue"
        />
        <PolicyRow
          label="> X and ≤ Y"
          title="Instant lane"
          copy="Passkey + secondary signer"
          color="violet"
        />
        <PolicyRow
          label="> Y"
          title="Delayed lane"
          copy="Two approvals + mandatory delay Z"
          color="pink"
        />
      </div>
    </article>
  );
}

function PolicyRow({
  label,
  title,
  copy,
  color,
}: {
  label: string;
  title: string;
  copy: string;
  color: string;
}) {
  return (
    <div className={`policy-row policy-${color}`}>
      <b>{label}</b>
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
    </div>
  );
}

function Note({
  icon,
  title,
  copy,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="architecture-note">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer" id="trust">
      <div className="landing-container">
        <div className="trust-strip">
          <span>
            <ShieldCheck /> Deny by default
          </span>
          <span>
            <Link2 /> Policy enforced onchain
          </span>
          <span>
            <FlaskConical /> Testnet prototype
          </span>
        </div>
        <div className="footer-bottom">
          <span className="brand-mark">
            <ShieldCheck className="size-5 text-violet-300" aria-hidden />
            <span>recent-tx-safe-guard</span>
          </span>
          <span>
            Independent review and audit required before production use.
          </span>
        </div>
      </div>
    </footer>
  );
}
