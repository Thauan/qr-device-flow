import {
  QRDeviceFlow,
  type ApprovedSession,
  type TransportType,
} from "@qr-device-flow/web";

// ── Public types ───────────────────────────────────────────────────

export interface QrStateDetail {
  /** Challenge status: pending, scanned, approved, denied, expired, approved-consumed, … */
  readonly status: string;
}

export interface QrApprovedDetail {
  /** Session issued by the server. The element never renders it into the DOM. */
  readonly session: ApprovedSession;
}

export interface QrErrorDetail {
  readonly message: string;
}

export interface QrDeviceLoginEventMap {
  "qr-state": CustomEvent<QrStateDetail>;
  "qr-approved": CustomEvent<QrApprovedDetail>;
  "qr-error": CustomEvent<QrErrorDetail>;
}

// ── Internals ──────────────────────────────────────────────────────

const TRANSPORTS: readonly TransportType[] = ["sse", "polling", "websocket"];
const DENIED_MESSAGE = "Authorization denied by user";

const MESSAGES: Record<string, string> = {
  loading: "Creating login request…",
  pending: "Scan the code with your logged-in app.",
  scanned: "Phone detected! Confirm on your device…",
  approved: "Approved on your phone, logging in…",
  denied: "Login denied on your phone.",
  expired: "The code expired. Try again.",
  "approved-consumed": "This login was already used.",
  "logged-in": "Logged in.",
};

const STYLE = `
  :host {
    --qr-accent: #2563eb;
    --qr-text: #1a1b23;
    --qr-muted: #5f6370;
    --qr-card: #ffffff;
    --qr-ok: #15803d;
    --qr-warn: #b45309;
    --qr-error: #b91c1c;
    --qr-radius: 16px;
    display: block;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--qr-text);
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --qr-text: #e7e9ef;
      --qr-muted: #9aa0ad;
      --qr-card: #181b24;
      --qr-accent: #60a5fa;
      --qr-ok: #4ade80;
      --qr-warn: #fbbf24;
      --qr-error: #f87171;
    }
  }
  [hidden] { display: none !important; }
  .card {
    background: var(--qr-card);
    border-radius: var(--qr-radius);
    padding: 24px;
    text-align: center;
    max-width: 360px;
    margin: 0 auto;
  }
  img {
    display: block;
    width: var(--qr-size, 220px);
    height: auto;
    margin: 0 auto 12px;
  }
  .code {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 1.3rem;
    letter-spacing: 0.15em;
    margin: 0 0 12px;
  }
  .number { font-size: 0.95rem; margin: 0 0 10px; color: var(--qr-muted); }
  .number strong { font-size: 1.6rem; letter-spacing: 0.1em; color: var(--qr-text); }
  .status { font-size: 0.95rem; min-height: 1.4em; margin: 0 0 10px; color: var(--qr-muted); }
  :host([data-state="scanned"]) .status { color: var(--qr-warn); }
  :host([data-state="logged-in"]) .status,
  :host([data-state="approved"]) .status { color: var(--qr-ok); }
  :host([data-state="denied"]) .status,
  :host([data-state="expired"]) .status,
  :host([data-state="approved-consumed"]) .status,
  .error { color: var(--qr-error); }
  .error { font-size: 0.85rem; margin: 0 0 10px; }
  button {
    font: inherit;
    padding: 10px 18px;
    border: 0;
    border-radius: 10px;
    background: var(--qr-accent);
    color: #fff;
    cursor: pointer;
  }
`;

const TEMPLATE = `
  <style>${STYLE}</style>
  <section class="card" part="card">
    <img part="qr" alt="Login QR code" hidden />
    <p part="code" class="code" hidden></p>
    <p part="number" class="number" hidden>Confirm on your phone: <strong part="number-value"></strong></p>
    <p part="status" class="status" role="status" aria-live="polite"></p>
    <p part="error" class="error" role="alert" hidden></p>
    <button part="retry" type="button" hidden>Try again</button>
  </section>
`;

// ── Element ────────────────────────────────────────────────────────

/**
 * `<qr-device-login>`: renders a login QR code, follows the challenge, and
 * fires `qr-state`, `qr-approved` and `qr-error` events (bubbling and composed).
 *
 * Attributes: `endpoint` (required), `transport` (`sse` | `polling` | `websocket`,
 * default `sse`), `qr-size` (px, default 220), `auto-regenerate` (boolean).
 *
 * Changing an attribute restarts the login. `disconnectedCallback` stops it.
 */
export class QrDeviceLoginElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["endpoint", "transport", "qr-size", "auto-regenerate"];
  }

  readonly #qr: HTMLImageElement;
  readonly #code: HTMLElement;
  readonly #number: HTMLElement;
  readonly #numberValue: HTMLElement;
  readonly #status: HTMLElement;
  readonly #error: HTMLElement;
  readonly #retry: HTMLButtonElement;

  #flow: QRDeviceFlow | null = null;
  /** Bumped on every start/stop. Callbacks from older logins are ignored. */
  #generation = 0;
  #connected = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    this.#qr = root.querySelector("img")!;
    this.#code = root.querySelector('[part="code"]')!;
    this.#number = root.querySelector('[part="number"]')!;
    this.#numberValue = root.querySelector('[part="number-value"]')!;
    this.#status = root.querySelector('[part="status"]')!;
    this.#error = root.querySelector('[part="error"]')!;
    this.#retry = root.querySelector("button")!;
    this.#retry.addEventListener("click", () => void this.restart());
  }

  // ── Properties (reflect to attributes) ─────────────────────────

  get endpoint(): string {
    return this.getAttribute("endpoint") ?? "";
  }
  set endpoint(value: string) {
    this.setAttribute("endpoint", value);
  }

  get transport(): TransportType {
    const value = this.getAttribute("transport") as TransportType | null;
    return value && TRANSPORTS.includes(value) ? value : "sse";
  }
  set transport(value: TransportType) {
    this.setAttribute("transport", value);
  }

  get qrSize(): number {
    const n = Number(this.getAttribute("qr-size"));
    return Number.isFinite(n) && n > 0 ? n : 220;
  }
  set qrSize(value: number) {
    this.setAttribute("qr-size", String(value));
  }

  get autoRegenerate(): boolean {
    return this.hasAttribute("auto-regenerate");
  }
  set autoRegenerate(value: boolean) {
    this.toggleAttribute("auto-regenerate", value);
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  connectedCallback(): void {
    this.#connected = true;
    void this.start();
  }

  disconnectedCallback(): void {
    this.#connected = false;
    this.#stop();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (this.#connected && oldValue !== newValue) {
      void this.restart();
    }
  }

  // ── Public methods ─────────────────────────────────────────────

  /** Starts a new login (creates a challenge and renders its QR code). */
  async start(): Promise<void> {
    this.#stop();
    const generation = ++this.#generation;
    const current = (): boolean => generation === this.#generation;

    this.#clearError();
    this.#setState("loading");
    this.#qr.hidden = true;
    this.#code.hidden = true;
    this.#retry.hidden = true;

    const endpoint = this.endpoint;
    if (!endpoint) {
      this.#fail("The qr-device-login element needs an endpoint attribute.", current);
      return;
    }

    const flow = new QRDeviceFlow({
      endpoint,
      transport: this.transport,
      qrSize: this.qrSize,
      autoRegenerate: this.autoRegenerate,
      onRegenerate: (result) => {
        if (current()) this.#render(result);
      },
      onStateChange: (status) => {
        if (!current()) return;
        this.#onStatus(status);
      },
      onApproved: (session) => {
        if (!current()) return;
        this.#onApproved(session);
      },
      onError: (err) => {
        // A denial is reported as a status; everything else is an error.
        if (!current() || err.message === DENIED_MESSAGE) return;
        this.#fail(err.message, current);
      },
    });
    this.#flow = flow;

    try {
      const result = await flow.startHeadless();
      if (!current()) return;
      this.#render(result);
    } catch (err) {
      this.#fail(err instanceof Error ? err.message : String(err), current);
    }
  }

  /** Stops the current login and starts a new one. */
  async restart(): Promise<void> {
    await this.start();
  }

  // ── Private ────────────────────────────────────────────────────

  #stop(): void {
    this.#generation++;
    this.#flow?.destroy();
    this.#flow = null;
  }

  #onStatus(status: string): void {
    this.#setState(status);

    // With auto-regenerate, an expiry is followed by onRegenerate (a new QR),
    // so the old one is left in place until the new one replaces it.
    const regenerating = status === "expired" && this.autoRegenerate;
    if (!regenerating) {
      this.#retry.hidden = !(status === "denied" || status === "expired" || status === "approved-consumed");
      if (status === "denied" || status === "expired" || status === "approved-consumed") {
        this.#qr.hidden = true;
        this.#code.hidden = true;
        this.#number.hidden = true;
      }
    }
    this.#emit("qr-state", { status });
  }

  #render(result: { qrDataUrl: string; userCode: string; verificationNumber: string | null }): void {
    this.#clearError();
    this.#qr.src = result.qrDataUrl;
    this.#qr.style.setProperty("--qr-size", `${this.qrSize}px`);
    this.#qr.hidden = false;
    this.#code.textContent = result.userCode;
    this.#code.hidden = false;
    // No number when the server runs with verification "none".
    this.#numberValue.textContent = result.verificationNumber ?? "";
    this.#number.hidden = result.verificationNumber === null;
    this.#retry.hidden = true;
    this.#setState("pending");
  }

  #onApproved(session: ApprovedSession): void {
    this.#setState("logged-in");
    this.#qr.hidden = true;
    this.#code.hidden = true;
    this.#number.hidden = true;
    this.#retry.hidden = true;
    this.#emit("qr-approved", { session });
  }

  #fail(message: string, current: () => boolean): void {
    if (!current()) return;
    this.#error.textContent = message;
    this.#error.hidden = false;
    this.#retry.hidden = false;
    this.#emit("qr-error", { message });
  }

  #clearError(): void {
    this.#error.hidden = true;
    this.#error.textContent = "";
  }

  #setState(state: string): void {
    this.dataset.state = state;
    this.#status.textContent = MESSAGES[state] ?? state;
  }

  #emit<K extends "qr-state" | "qr-approved" | "qr-error">(
    type: K,
    detail: K extends "qr-state" ? QrStateDetail : K extends "qr-approved" ? QrApprovedDetail : QrErrorDetail,
  ): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

/**
 * Registers `<qr-device-login>` (default name). Safe to call more than once.
 * Does nothing outside the browser.
 */
export function defineQrDeviceLogin(name = "qr-device-login"): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(name)) {
    customElements.define(name, QrDeviceLoginElement);
  }
}

// Typed for `document.querySelector("qr-device-login")` and JSX/TSX.
declare global {
  interface HTMLElementTagNameMap {
    "qr-device-login": QrDeviceLoginElement;
  }
}

defineQrDeviceLogin();
