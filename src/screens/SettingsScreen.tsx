// Settings: a menu of pages. On a phone the menu is one screen and each page
// another; from tablet width up the menu stays beside the page that is open.

import {
  ChevronRightIcon,
  CodeIcon,
  InfoIcon,
  KeyIcon,
  PaintbrushIcon,
  PersonIcon,
  type Icon,
} from "@primer/octicons-react";
import { getVersion } from "@tauri-apps/api/app";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../lib/api";
import { backend, type AuthConfig } from "../lib/backend";
import { isApple, SHORTCUTS } from "../lib/desktop";
import { fullDate } from "../lib/format";
import { to, type SettingsSection } from "../lib/nav";
import { setPref, useMediaQuery, usePrefs, type Prefs } from "../lib/prefs";
import { useIsGuest, useSessionApi } from "../lib/session";
import { useToast } from "../lib/toast";
import { guestQueries } from "../queries/guest";
import { viewerQueries } from "../queries/viewer";
import { Screen } from "../components/Screen";

/** From this width the menu and the open page are side by side. */
const TWO_PANES = "(min-width: 768px)";
/** Where there is a keyboard to use shortcuts with. */
const HAS_KEYBOARD = "(hover: hover) and (pointer: fine)";

const THEME_LABEL: Record<Prefs["theme"], string> = { system: "Same as the device", light: "Light", dark: "Dark" };

interface Page {
  section: SettingsSection;
  title: string;
  icon: Icon;
  /** What it is set to right now, shown in the menu. */
  summary: string;
}

function usePages(): Page[] {
  const prefs = usePrefs();
  const { state } = useSessionApi();
  const keyboard = useMediaQuery(HAS_KEYBOARD);
  const version = useVersion();
  const pages: (Page | null)[] = [
    {
      section: "account",
      title: "Account",
      icon: PersonIcon,
      summary: state.status === "signed-in" ? `Signed in as ${state.session.login}` : "Browsing without signing in",
    },
    { section: "appearance", title: "Appearance", icon: PaintbrushIcon, summary: THEME_LABEL[prefs.theme] },
    {
      section: "code",
      title: "Code and diffs",
      icon: CodeIcon,
      summary: [prefs.splitDiff ? "Side by side" : "One column", prefs.wrapDiff ? "wrapped" : "not wrapped"].join(", "),
    },
    // The OAuth app only matters where the app signs in itself.
    backend.native ? { section: "sign-in", title: "GitHub sign-in", icon: KeyIcon, summary: "The OAuth app used to sign in" } : null,
    keyboard ? { section: "shortcuts", title: "Keyboard shortcuts", icon: KeyboardIcon, summary: `${SHORTCUTS.length} shortcuts` } : null,
    { section: "about", title: "About", icon: InfoIcon, summary: version !== null ? `Better GitHub ${version}` : "Better GitHub" },
  ];
  return pages.filter((page) => page !== null);
}

/** Octicons has no keyboard; a key cap stands in. */
function KeyboardIcon({ size = 16 }: { size?: number | "small" | "medium" | "large" }) {
  const px = typeof size === "number" ? size : 16;
  return (
    <svg className="octicon" width={px} height={px} viewBox="0 0 16 16" aria-hidden>
      <path d="M1.75 3h12.5c.966 0 1.75.784 1.75 1.75v6.5A1.75 1.75 0 0 1 14.25 13H1.75A1.75 1.75 0 0 1 0 11.25v-6.5C0 3.784.784 3 1.75 3Zm0 1.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25ZM3 6h1.5v1.5H3Zm2.75 0h1.5v1.5h-1.5ZM8.5 6H10v1.5H8.5Zm2.75 0h1.5v1.5h-1.5ZM4 9h8v1.5H4Z" />
    </svg>
  );
}

function useVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (backend.native) getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);
  return version;
}

export function SettingsScreen({ section }: { section: SettingsSection | null }) {
  const pages = usePages();
  const twoPanes = useMediaQuery(TWO_PANES);
  // Beside the menu there is always a page open: the first, until one is picked.
  const open = pages.find((page) => page.section === section) ?? (twoPanes ? pages[0] : undefined);
  const showMenu = twoPanes || section === null;

  return (
    <Screen title={!twoPanes && open ? open.title : "Settings"} subtitle={twoPanes && open ? open.title : undefined}>
      <div className={`settings${twoPanes ? " two-panes" : ""}`}>
        {showMenu && (
          <nav className="settings-menu" aria-label="Settings">
            {pages.map((page) => (
              <Link
                key={page.section}
                {...to.settings(page.section)}
                // Beside the menu, picking another page swaps it rather than stacking screens to go back through.
                replace={twoPanes && section !== null}
                className="settings-entry"
                aria-current={twoPanes && open?.section === page.section ? "page" : undefined}
              >
                <page.icon size={18} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="settings-entry-title">{page.title}</span>
                  <span className="muted small ellipsis" style={{ display: "block" }}>
                    {page.summary}
                  </span>
                </span>
                <ChevronRightIcon size={16} className="c-muted" />
              </Link>
            ))}
          </nav>
        )}
        {open && (twoPanes || section !== null) && (
          <section className="settings-page" aria-label={open.title}>
            <SettingsPage section={open.section} />
          </section>
        )}
      </div>
    </Screen>
  );
}

function SettingsPage({ section }: { section: SettingsSection }) {
  switch (section) {
    case "account":
      return <AccountPage />;
    case "appearance":
      return <AppearancePage />;
    case "code":
      return <CodePage />;
    case "sign-in":
      return <SignInPage />;
    case "shortcuts":
      return <ShortcutsPage />;
    case "about":
      return <AboutPage />;
  }
}

function Row({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="kv">
      <span className="grow">
        {title}
        {children !== undefined && (
          <span className="muted small" style={{ display: "block" }}>
            {children}
          </span>
        )}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ account

function AccountPage() {
  return useIsGuest() ? <GuestAccount /> : <SignedInAccount />;
}

function GuestAccount() {
  const sessionApi = useSessionApi();
  const rate = useQuery(guestQueries.rateLimit());
  return (
    <>
      <Row title="Browsing without signing in">Public profiles and repositories only</Row>
      {rate.data && (
        <Row title="API rate limit">
          {rate.data.remaining.toLocaleString()} of {rate.data.limit.toLocaleString()} requests left · resets {fullDate(rate.data.resetAt)}
        </Row>
      )}
      <div className="pad">
        <button className="btn btn-block btn-primary" onClick={() => void sessionApi.leaveGuest()}>
          Sign in to GitHub
        </button>
      </div>
    </>
  );
}

function SignedInAccount() {
  const sessionApi = useSessionApi();
  const state = sessionApi.state;
  const rate = useQuery(viewerQueries.rateLimit());
  const rateLimit = rate.data?.rateLimit ?? null;
  if (state.status !== "signed-in") return null;
  const session = state.session;
  return (
    <>
      <Row
        title={
          <>
            Signed in as <strong>{session.login}</strong>
          </>
        }
      >
        {session.method === "device" ? "via GitHub sign-in" : "with a personal access token"}
        {session.scopes !== null && session.scopes !== "" ? ` · scopes: ${session.scopes}` : ""}
      </Row>
      {rateLimit && (
        <Row title="API rate limit">
          {rateLimit.remaining.toLocaleString()} of {rateLimit.limit.toLocaleString()} points left · resets {fullDate(rateLimit.resetAt)}
        </Row>
      )}
      <div className="pad">
        <button className="btn btn-block btn-danger" onClick={() => void sessionApi.signOut()}>
          Sign out
        </button>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Signing out removes the token from this device. To revoke it everywhere, visit GitHub → Settings → Applications.
        </p>
      </div>
    </>
  );
}

// --------------------------------------------------------------- appearance

function AppearancePage() {
  const prefs = usePrefs();
  return (
    <>
      <h3 className="section-title">Theme</h3>
      <div className="theme-options" role="radiogroup" aria-label="Theme">
        {(["system", "light", "dark"] as const).map((theme) => (
          <button
            key={theme}
            role="radio"
            aria-checked={prefs.theme === theme}
            className={`theme-option${prefs.theme === theme ? " active" : ""}`}
            onClick={() => setPref("theme", theme)}
          >
            {/* A small picture of the app in that theme; "system" is half of each. */}
            <span className="theme-swatch" data-swatch={theme} aria-hidden>
              <span />
              <span />
              <span />
            </span>
            {theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0, padding: "0 16px 16px" }}>
        System follows the device's light or dark setting, also when it changes while the app is open.
      </p>
    </>
  );
}

// --------------------------------------------------------------------- code

function Toggle({ pref, title, children }: { pref: "wrapDiff" | "wrapCode" | "splitDiff"; title: string; children?: ReactNode }) {
  const prefs = usePrefs();
  return (
    <label className="kv checkbox-row">
      <input type="checkbox" checked={prefs[pref]} onChange={(e) => setPref(pref, e.target.checked)} />
      <span className="grow">
        {title}
        {children !== undefined && (
          <span className="muted small" style={{ display: "block" }}>
            {children}
          </span>
        )}
      </span>
    </label>
  );
}

function CodePage() {
  return (
    <>
      <h3 className="section-title">Diffs</h3>
      <Toggle pref="splitDiff" title="Show diffs side by side in wide windows">
        The old file on the left, the new one on the right, from 1100 px wide.
      </Toggle>
      <Toggle pref="wrapDiff" title="Wrap long lines in diffs">
        When diffs are in one column. Side by side always wraps.
      </Toggle>
      <h3 className="section-title">Files</h3>
      <Toggle pref="wrapCode" title="Wrap long lines in files" />
    </>
  );
}

// ------------------------------------------------------------------ sign-in

function SignInPage() {
  const toast = useToast();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    void backend.authConfig().then((c) => {
      setConfig(c);
      setClientId(c.clientId ?? "");
    });
  }, []);

  const save = async () => {
    try {
      const trimmed = clientId.trim();
      const next = await backend.authSetClientId(trimmed === "" ? null : trimmed);
      setConfig(next);
      setClientId(next.clientId ?? "");
      toast.show("Saved", "success");
    } catch (e) {
      toast.show(errorMessage(e), "error");
    }
  };

  if (!backend.native || !config) return <p className="pad muted">Signing in with GitHub is set up in the app, not in a browser.</p>;
  return (
    <div className="pad stack-v">
      <div>
        <label className="field-label" htmlFor="settings-client-id">
          OAuth app client id
        </label>
        <input
          id="settings-client-id"
          className="input mono"
          value={clientId}
          placeholder={config.clientIdSource === "build" ? "Using the built-in app" : "Not set"}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setClientId(e.target.value)}
        />
        <p className="muted small" style={{ marginBottom: 0 }}>
          {config.clientIdSource === "build"
            ? "This build ships with an OAuth app. Enter another client id to override it."
            : "Used for “Sign in with GitHub”. The OAuth app must have Device Flow enabled."}
        </p>
      </div>
      <button className="btn" onClick={() => void save()}>
        Save client id
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- shortcuts

function ShortcutsPage() {
  return (
    <>
      {SHORTCUTS.map((shortcut) => (
        <div key={shortcut.label} className="kv">
          <span className="grow">{shortcut.label}</span>
          <span className="shortcut-keys">
            {shortcut.keys(isApple()).map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </span>
        </div>
      ))}
    </>
  );
}

// -------------------------------------------------------------------- about

function AboutPage() {
  const version = useVersion();
  return (
    <>
      <Row title={`Better GitHub${version !== null && version !== "" ? ` ${version}` : ""}`}>A fast, review-focused GitHub client.</Row>
      <button
        className="kv"
        style={{ width: "100%", border: 0, borderBottom: "1px solid var(--border-muted)", background: "none", textAlign: "left", color: "var(--accent)" }}
        onClick={() => void backend.openUrl("https://github.com/madsbuch/better-github")}
      >
        Source code on GitHub
      </button>
    </>
  );
}
