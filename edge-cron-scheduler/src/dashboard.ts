export function dashboard(): string {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Edge Cron · Telnyx</title>
    <style>
      :root {
        --ink: #142b2a;
        --muted: #687b78;
        --green: #c1f56b;
        --line: #e0e8e4;
        --paper: #f5f7f4;
        --red: #aa3936;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: var(--paper);
        color: var(--ink);
        font:
          15px/1.5 -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
      }
      button,
      input,
      select,
      textarea {
        font: inherit;
      }
      button {
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.45;
        cursor: wait;
      }
      button:focus-visible,
      a:focus-visible,
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible {
        outline: 3px solid #72993e;
        outline-offset: 3px;
      }
      button {
        border: 0;
        border-radius: 8px;
        padding: 10px 16px;
        font-weight: 650;
        transition:
          background 0.15s,
          transform 0.15s;
      }
      button:active {
        transform: translateY(1px);
      }
      .primary {
        background: var(--green);
        color: #193729;
      }
      .primary:hover {
        background: #abe94e;
      }
      .secondary {
        background: white;
        border: 1px solid var(--line);
        color: var(--ink);
      }
      .secondary:hover {
        background: #edf2eb;
      }
      .ghost {
        background: transparent;
        color: var(--muted);
      }
      .dark {
        background: #203f37;
        color: white;
      }
      .small {
        font-size: 12px;
        padding: 7px 10px;
      }
      .brand {
        font-size: 23px;
        font-weight: 800;
        letter-spacing: -1px;
      }
      .brand i {
        font-style: normal;
        color: var(--green);
        font-size: 27px;
        margin-left: 3px;
      }
      .topbar {
        height: 76px;
        background: #142e29;
        color: white;
        display: flex;
        align-items: center;
        padding: 0 max(32px, calc((100vw - 1264px) / 2));
        gap: 24px;
      }
      .product {
        border-left: 1px solid #466057;
        padding-left: 24px;
        font-size: 14px;
        letter-spacing: 0.2px;
        color: #d7e3d8;
      }
      .topright {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 20px;
        font-size: 12px;
        color: #cedbd3;
      }
      .dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        background: #b7ef6e;
        border-radius: 100%;
        margin-right: 7px;
      }
      .topright button {
        color: #cedbd3;
        background: transparent;
        font-size: 12px;
        padding: 5px;
      }
      .wrap {
        max-width: 1328px;
        padding: 32px;
        margin: auto;
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 2px;
        font-size: 11px;
        font-weight: 750;
        color: #91b68e;
        margin-bottom: 12px;
      }
      .hero {
        background: #193a31;
        border-radius: 16px;
        padding: 32px 36px;
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: 32px;
        color: #f6faee;
        position: relative;
        overflow: hidden;
      }
      .hero h1 {
        font-size: 38px;
        line-height: 1.15;
        letter-spacing: -1.4px;
        margin: 0 0 12px;
        font-weight: 600;
      }
      .hero p {
        color: #b7cec1;
        max-width: 580px;
        margin: 0;
        font-size: 15px;
      }
      .timer {
        border-left: 1px solid #466151;
        padding-left: 36px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .timer label {
        font-size: 12px;
        color: #bdd1c0;
      }
      .timer strong {
        font-variant-numeric: tabular-nums;
        font-size: 44px;
        letter-spacing: -2px;
        font-weight: 450;
        line-height: 1.3;
      }
      .timer small {
        color: #9dbaa9;
        font-size: 11px;
      }
      .notice {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin: 18px 0 24px;
        color: #69806c;
        font-size: 12px;
      }
      .mode {
        font-weight: 650;
        color: #405f3c;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        margin-bottom: 32px;
      }
      .stat {
        background: white;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 18px 22px;
      }
      .stat span {
        display: block;
        font-size: 12px;
        color: var(--muted);
      }
      .stat strong {
        display: block;
        font-size: 29px;
        letter-spacing: -1px;
        font-weight: 550;
        margin-top: 3px;
      }
      .stat em {
        font-style: normal;
        font-size: 11px;
        color: var(--muted);
        margin-left: 8px;
        font-weight: 400;
      }
      .section-title {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      .section-title h2 {
        font-size: 19px;
        font-weight: 650;
        letter-spacing: -0.45px;
        margin: 0;
      }
      .section-title .actions {
        margin-left: auto;
        display: flex;
        gap: 8px;
      }
      .count {
        background: #e6ece3;
        color: #667a61;
        border-radius: 5px;
        padding: 1px 7px;
        font-size: 11px;
      }
      .jobs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-bottom: 32px;
      }
      .job {
        border: 1px solid var(--line);
        background: white;
        border-radius: 12px;
        padding: 22px;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .job-head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 18px;
      }
      .icon {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: #edf4e7;
        color: #4c7233;
      }
      .icon svg {
        width: 20px;
        height: 20px;
      }
      .type {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1.4px;
        font-weight: 650;
        color: #687c67;
      }
      .pill {
        margin-left: auto;
        border-radius: 5px;
        font-size: 10px;
        padding: 3px 7px;
        background: #edf3e9;
        color: #52713b;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-weight: 650;
      }
      .pill.failure {
        background: #fcebea;
        color: #a84642;
      }
      .job h3 {
        font-size: 18px;
        letter-spacing: -0.35px;
        margin: 0 0 5px;
        font-weight: 650;
      }
      .target {
        font-size: 12px;
        color: #7a8b82;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 24px;
      }
      .job-meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        padding: 10px 0;
        border-top: 1px solid #edf0eb;
      }
      .job-meta span {
        color: var(--muted);
      }
      .job-meta strong {
        font-weight: 550;
        font-variant-numeric: tabular-nums;
      }
      .job-footer {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }
      .job-footer .run {
        flex: 1;
      }
      .empty {
        background: white;
        border: 1px dashed #bacbb9;
        border-radius: 12px;
        text-align: center;
        padding: 44px 24px;
        grid-column: 1/-1;
      }
      .empty h3 {
        font-weight: 600;
        margin: 8px 0;
      }
      .empty p {
        font-size: 13px;
        color: var(--muted);
        margin: 0 0 18px;
      }
      .history {
        background: white;
        border: 1px solid var(--line);
        border-radius: 12px;
        overflow: hidden;
      }
      .history-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 22px;
        border-bottom: 1px solid var(--line);
      }
      .history-toolbar h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.4px;
      }
      .filters {
        display: flex;
        background: #f0f3ee;
        padding: 3px;
        border-radius: 7px;
        gap: 2px;
      }
      .filters button {
        font-size: 11px;
        background: transparent;
        color: var(--muted);
        padding: 5px 12px;
        border-radius: 5px;
      }
      .filters button.active {
        background: white;
        color: var(--ink);
        box-shadow: 0 1px 3px #15332216;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
      }
      th {
        font-size: 10px;
        color: #7b8a81;
        letter-spacing: 1px;
        text-transform: uppercase;
        font-weight: 600;
        padding: 13px 22px;
        background: #fafbf8;
      }
      td {
        font-size: 12px;
        padding: 15px 22px;
        border-top: 1px solid #f0f3ec;
      }
      td:first-child {
        font-weight: 600;
      }
      .state {
        font-size: 11px;
        color: #477740;
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .state:before {
        content: "";
        width: 6px;
        height: 6px;
        background: currentColor;
        border-radius: 50%;
      }
      .state.failure {
        color: #b64945;
      }
      .state.running {
        color: #9d782c;
      }
      .state.skipped {
        color: #7a8580;
      }
      .time {
        color: #718178;
        font-variant-numeric: tabular-nums;
      }
      .history-note {
        padding: 12px 22px;
        font-size: 10px;
        color: #89968d;
        border-top: 1px solid var(--line);
      }
      .footer {
        margin-top: 24px;
        display: flex;
        justify-content: space-between;
        color: #89968c;
        font-size: 11px;
      }
      .live-label {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .live-label .dot {
        background: #608951;
        width: 5px;
        height: 5px;
      }
      .banner {
        padding: 12px 16px;
        background: #ffeddf;
        color: #844c2a;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 13px;
      }
      .toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        padding: 13px 22px;
        border: 1px solid #40614e;
        background: #183c2e;
        color: white;
        border-radius: 9px;
        box-shadow: 0 8px 32px #14322230;
        font-size: 13px;
        z-index: 10;
        max-width: 90vw;
      }
      .toast.error {
        background: #74362f;
      }
      dialog {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 28px;
        max-width: 480px;
        width: calc(100% - 32px);
        color: var(--ink);
        box-shadow: 0 30px 120px #10241e40;
      }
      dialog::backdrop {
        background: #122f2566;
        backdrop-filter: blur(4px);
      }
      dialog h2 {
        margin: 0 0 6px;
        font-weight: 600;
        font-size: 24px;
        letter-spacing: -0.8px;
      }
      dialog p {
        font-size: 13px;
        color: var(--muted);
        margin: 0 0 22px;
      }
      label.field {
        display: block;
        font-size: 12px;
        font-weight: 650;
        margin: 14px 0 0;
      }
      input,
      select,
      textarea {
        display: block;
        width: 100%;
        border: 1px solid #d6dfd2;
        border-radius: 7px;
        padding: 10px 12px;
        background: #fafcf8;
        color: var(--ink);
        margin-top: 6px;
        font-size: 13px;
      }
      textarea {
        resize: vertical;
        min-height: 70px;
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 24px;
      }
      .dialog-error {
        color: var(--red);
        font-size: 12px;
        margin-top: 12px;
      }
      .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--muted);
        margin-top: 16px;
      }
      .check input {
        width: auto;
        margin: 0;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #f1f5ed;
        border-radius: 9px;
        padding: 16px;
        font-size: 12px;
        max-height: 50vh;
        overflow: auto;
      }
      .details-label {
        font-size: 12px;
        color: var(--muted);
        margin-top: 16px;
      }
      .recording .topbar {
        height: 66px;
      }
      .recording .wrap {
        padding-top: 22px;
      }
      .recording .hero {
        padding: 24px 30px;
      }
      .recording .hero h1 {
        font-size: 32px;
      }
      .recording .stats {
        margin-bottom: 22px;
      }
      .recording .job {
        padding: 18px;
      }
      .recording .target {
        margin-bottom: 16px;
      }
      .recording .jobs {
        margin-bottom: 22px;
      }
      .recording .footer {
        display: none;
      }
      .table-scroll {
        max-height: 420px;
        overflow: auto;
      }
      th {
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .recording .stats {
        gap: 12px;
        margin-bottom: 20px;
      }
      .recording .stat {
        padding: 12px 18px;
      }
      .recording .stat strong {
        font-size: 25px;
      }
      .recording .job-head {
        margin-bottom: 12px;
      }
      .recording .job-meta {
        padding: 7px 0;
      }
      .recording .job-footer {
        margin-top: 12px;
      }
      .recording .job-footer button {
        padding-top: 8px;
        padding-bottom: 8px;
      }
      .recording .notice {
        margin: 12px 0 18px;
      }
      .recording .job h3 {
        font-size: 17px;
      }
      .recording .table-scroll {
        max-height: 220px;
      }
      .recording td {
        padding-top: 11px;
        padding-bottom: 11px;
      }
      .recording .history-toolbar {
        padding: 13px 22px;
      }
      [hidden] {
        display: none !important;
      }
      @media (max-width: 900px) {
        .hero {
          grid-template-columns: 1fr 200px;
        }
        .hero h1 {
          font-size: 30px;
        }
        .timer {
          padding-left: 22px;
        }
        .jobs {
          grid-template-columns: 1fr;
        }
        .stats {
          grid-template-columns: repeat(2, 1fr);
        }
        .table-scroll {
          overflow-x: auto;
        }
        .topbar {
          padding: 0 24px;
        }
        .wrap {
          padding: 24px;
        }
        .section-title {
          flex-wrap: wrap;
        }
        .section-title .actions {
          flex-wrap: wrap;
        }
      }
      @media (max-width: 600px) {
        .hero {
          grid-template-columns: 1fr;
        }
        .timer {
          border-left: 0;
          border-top: 1px solid #466151;
          padding: 15px 0 0;
        }
        .timer strong {
          font-size: 32px;
        }
        .product {
          display: none;
        }
        .notice {
          align-items: flex-start;
          flex-direction: column;
        }
        .topright {
          gap: 8px;
        }
        .history-toolbar {
          align-items: flex-start;
          gap: 12px;
          flex-direction: column;
        }
        .section-title .actions {
          margin-left: 0;
          width: 100%;
        }
        .hero {
          padding: 24px;
        }
        .form-grid {
          grid-template-columns: 1fr;
        }
      }
      .recording .hero { padding: 18px 28px; }
      .recording .hero h1 { font-size: 30px; margin-bottom: 8px; }
      .recording .hero p { font-size: 13px; }
      .recording .timer strong { font-size: 38px; }
      .recording .job { padding: 14px 18px; }
      .recording .job-head { margin-bottom: 8px; }
      .recording .job-meta { padding: 5px 0; }
      .recording .target { margin-bottom: 10px; }
      .recording .table-scroll { max-height: 200px; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand">telnyx<i>✳</i></div>
      <div class="product">Edge Cron Scheduler</div>
      <div class="topright">
        <span id="connection"><span class="dot"></span>Connecting</span
        ><button id="recording" aria-pressed="false">Recording view</button
        ><button id="disconnect" hidden>Disconnect</button>
      </div>
    </header>
    <main class="wrap">
      <div id="banner" class="banner" role="alert" hidden></div>
      <section class="hero">
        <div>
          <div class="eyebrow">Set it once. Keep it running.</div>
          <h1>Your jobs. Right on time.</h1>
          <p>
            Schedule a call, send a message, trigger a webhook.<br />One place to see every run and
            catch every failure.
          </p>
        </div>
        <div class="timer">
          <label>Next scheduler check</label><strong id="countdown">—</strong
          ><small id="next-label">Connect to your scheduler to begin</small>
        </div>
      </section>
      <div class="notice">
        <span id="mode-note"
          ><span class="mode">Demo mode</span> · Communications are simulated. Scheduling and
          history are real.</span
        ><span class="live-label"
          ><span class="dot"></span><span id="updated">Waiting for connection</span></span
        >
      </div>
      <section class="stats" aria-label="Scheduler statistics">
        <div class="stat"><span>Scheduled jobs</span><strong id="stat-jobs">—</strong></div>
        <div class="stat"><span>Successful runs</span><strong id="stat-success">—</strong></div>
        <div class="stat"><span>Failed runs</span><strong id="stat-failure">—</strong></div>
        <div class="stat"><span>Failure alerts</span><strong id="stat-alerts">—</strong></div>
      </section>
      <section>
        <div class="section-title">
          <h2>Scheduled jobs</h2>
          <span class="count" id="job-count">0</span>
          <div class="actions">
            <button class="ghost small" id="seed">Load demo jobs</button
            ><button class="secondary small" id="fail-demo">Try a failure</button
            ><button class="secondary small" id="run-all">▶ Run all</button
            ><button class="dark small" id="create">+ Create job</button>
          </div>
        </div>
        <div class="jobs" id="jobs">
          <div class="empty">
            <h3>Your scheduler is ready</h3>
            <p>Connect to load your saved jobs and execution history.</p>
            <button class="primary" id="connect">Connect scheduler</button>
          </div>
        </div>
      </section>
      <section class="history">
        <div class="history-toolbar">
          <h2>Execution history</h2>
          <div class="filters" aria-label="Filter executions">
            <button class="active" data-filter="all">All runs</button
            ><button data-filter="success">Successful</button
            ><button data-filter="failure">Failed</button>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Result</th>
                <th>Time</th>
                <th>Alert</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="history">
              <tr>
                <td
                  colspan="6"
                  style="text-align: center; padding: 32px; color: #88978b; font-weight: 400"
                >
                  Your execution history will appear here.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="history-note">
          Statistics and history cover the latest 100 runs · Schedule times are UTC · Success means
          request acceptance, not final delivery
        </div>
      </section>
      <footer class="footer">
        <span>Built with Telnyx Agent SDK</span
        ><span>Durable scheduling / Persistent history / Failure notifications</span>
      </footer>
    </main>
    <dialog id="login">
      <form id="login-form">
        <h2>Connect your scheduler</h2>
        <p>
          Paste the local access token printed by <code>npm start</code>. It stays in this tab’s
          session.
        </p>
        <label class="field"
          >Access token<input
            id="token"
            type="password"
            required
            autocomplete="off"
            placeholder="Your scheduler token"
        /></label>
        <div id="login-error" class="dialog-error" role="alert"></div>
        <div class="dialog-actions"><button type="submit" class="primary">Connect</button></div>
      </form>
    </dialog>
    <dialog id="job-dialog">
      <form id="job-form">
        <h2>Create a job</h2>
        <p>Choose an action and a schedule. We’ll handle the timing.</p>
        <label class="field"
          >Job name<input
            name="name"
            required
            maxlength="120"
            placeholder="e.g. Morning team check-in"
        /></label>
        <div class="form-grid">
          <label class="field"
            >Action<select name="type" id="job-type">
              <option value="sms">Send SMS</option>
              <option value="call">Place a call</option>
              <option value="webhook">Send webhook</option>
            </select></label
          ><label class="field"
            >Schedule<select name="schedule" id="job-schedule">
              <option value="* * * * *">Every minute</option>
              <option value="*/5 * * * *">Every 5 minutes</option>
              <option value="0 * * * *">Every hour</option>
              <option value="0 9 * * *">Daily at 09:00 UTC</option>
              <option value="custom">Custom cron</option>
            </select></label
          >
        </div>
        <label class="field" id="custom-cron" hidden
          >UTC cron expression<input name="cron" placeholder="0 9 * * *" /></label
        ><label class="field"
          ><span id="target-label">Phone number</span
          ><input name="target" id="job-target" required placeholder="+18005550102" /></label
        ><label class="field" id="payload-field"
          ><span id="payload-label">Message</span
          ><textarea
            name="payload"
            id="job-payload"
            placeholder="Hello from your scheduler"
          ></textarea></label
        ><label class="check" id="simulate-field"
          ><input name="failure" type="checkbox" />Simulate a failure for this job</label
        >
        <div id="job-error" class="dialog-error" role="alert"></div>
        <div class="dialog-actions">
          <button type="button" class="secondary" id="cancel-job">Cancel</button
          ><button type="submit" class="primary">Create job</button>
        </div>
      </form>
    </dialog>
    <dialog id="detail-dialog">
      <h2>Execution details</h2>
      <p id="detail-summary"></p>
      <pre id="detail-json"></pre>
      <div class="dialog-actions"><button class="secondary" id="close-detail">Close</button></div>
    </dialog>
    <div id="toast" class="toast" role="status" hidden></div>
    <script>
      (function () {
        "use strict";
        var $ = function (id) {
          return document.getElementById(id);
        };
        var token =
          new URLSearchParams(location.hash.slice(1)).get("token") ||
          sessionStorage.getItem("cron-token") ||
          "";
        if (location.hash) history.replaceState(null, "", location.pathname);
        var jobs = [],
          logs = [],
          health = null,
          filter = "all",
          busy = false,
          refreshing = false,
          lastUpdate = 0,
          toastTimer,
          lastSnapshot = "";
        var icons = {
          sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg>',
          call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m8 3 3 5-3 3c2 3 3 4 5 5l3-3 5 3c-1 5-4 6-8 4C6 17 2 11 3 6c0-2 3-3 5-3Z"/></svg>',
          webhook:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/></svg>',
        };
        function esc(x) {
          return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
          });
        }
        function time(x) {
          return (
            new Date(x).toLocaleTimeString("en-GB", {
              timeZone: "UTC",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }) + " UTC"
          );
        }
        function schedule(cron) {
          return (
            {
              "* * * * *": "Every minute",
              "*/5 * * * *": "Every 5 minutes",
              "0 * * * *": "Every hour",
              "0 9 * * *": "Daily at 09:00 UTC",
            }[cron] || cron
          );
        }
        function toast(message, error) {
          $("toast").textContent = message;
          $("toast").className = "toast" + (error ? " error" : "");
          $("toast").hidden = false;
          clearTimeout(toastTimer);
          toastTimer = setTimeout(function () {
            $("toast").hidden = true;
          }, 5000);
        }
        async function api(path, method, body) {
          var r = await fetch(path, {
            method: method || "GET",
            headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          var data = r.status === 204 ? null : await r.json();
          if (!r.ok) {
            if (r.status === 401) {
              token = "";
              sessionStorage.removeItem("cron-token");
              $("login").showModal();
            }
            throw new Error(data.error || "Request failed (" + r.status + ")");
          }
          return data;
        }
        function buttons() {
          document
            .querySelectorAll("#create,#seed,#fail-demo,#run-all,.run,.delete")
            .forEach(function (b) {
              b.disabled =
                busy ||
                !health ||
                (b.dataset.run &&
                  jobs.some(function (j) {
                    return j.id === b.dataset.run && j.dependsOn.length;
                  }));
            });
          $("run-all").disabled =
            busy ||
            !health ||
            !jobs.some(function (j) {
              return !j.dependsOn.length;
            });
          $("seed").hidden = health && !health.demoMode;
          $("fail-demo").hidden = health && !health.demoMode;
        }
        function render() {
          $("job-count").textContent = jobs.length;
          $("stat-jobs").textContent = jobs.length;
          $("stat-success").textContent = logs.filter(function (l) {
            return l.status === "success";
          }).length;
          $("stat-failure").textContent = logs.filter(function (l) {
            return l.status === "failure";
          }).length;
          var alerts = logs.filter(function (l) {
            return l.notification === "simulated" || l.notification === "sent";
          }).length;
          $("stat-alerts").innerHTML =
            alerts + "<em>" + (health && health.demoMode ? "simulated" : "sent") + "</em>";
          $("jobs").innerHTML = jobs.length
            ? jobs
                .map(function (j) {
                  var latest = logs.find(function (l) {
                    return l.job_id === j.id;
                  });
                  return (
                    '<article class="job"><div class="job-head"><span class="icon">' +
                    icons[j.type] +
                    '</span><span class="type">' +
                    j.type +
                    '</span><span class="pill ' +
                    (j.demoFailure && health && health.demoMode ? "failure" : "") +
                    '">' +
                    (j.demoFailure && health && health.demoMode ? "Failure demo" : "Scheduled") +
                    "</span></div><h3>" +
                    esc(j.name) +
                    '</h3><div class="target" title="' +
                    esc(j.target) +
                    '">' +
                    esc(j.target) +
                    '</div><div class="job-meta"><span>Schedule</span><strong>' +
                    esc(schedule(j.cron)) +
                    '</strong></div><div class="job-meta"><span>Next due</span><strong>' +
                    time(j.nextRun) +
                    '</strong></div><div class="job-meta"><span>Last run</span><strong>' +
                    (latest
                      ? '<span class="state ' +
                        esc(latest.status) +
                        '">' +
                        esc(latest.status) +
                        "</span>"
                      : "Not run yet") +
                    '</strong></div><div class="job-footer"><button class="secondary run" data-run="' +
                    esc(j.id) +
                    '" ' +
                    (j.dependsOn.length
                      ? 'disabled title="Runs after dependencies on schedule"'
                      : "") +
                    '>▶ Run now</button><button class="ghost small delete" data-delete="' +
                    esc(j.id) +
                    '" aria-label="Delete ' +
                    esc(j.name) +
                    '">Remove</button></div></article>'
                  );
                })
                .join("")
            : '<div class="empty"><h3>Put your first job on the clock</h3><p>Create a job, then let its schedule take over.</p>' + (health && health.demoMode ? '<button class="primary" data-seed>Load demo jobs</button>' : '<button class="primary" data-create>Create job</button>') + '</div>';
          var rows = logs.filter(function (l) {
            return filter === "all" || l.status === filter;
          });
          $("history").innerHTML = rows.length
            ? rows
                .map(function (l) {
                  var j = jobs.find(function (j) {
                    return j.id === l.job_id;
                  });
                  var result = l.result
                    .replace("simulated_", "Simulated ")
                    .replace("sms_accepted:", "SMS accepted · ")
                    .replace("call_accepted:", "Call accepted · ")
                    .replace("webhook_accepted:", "Webhook accepted · ");
                  return (
                    "<tr><td>" +
                    esc(j ? j.name : l.job_id) +
                    '</td><td><span class="state ' +
                    esc(l.status) +
                    '">' +
                    esc(l.status.charAt(0).toUpperCase() + l.status.slice(1)) +
                    "</span></td><td>" +
                    esc(result) +
                    '</td><td class="time">' +
                    time(l.started_at) +
                    '</td><td class="time">' +
                    esc(l.notification === "not_needed" ? "—" : l.notification) +
                    '</td><td><button class="ghost small" data-detail="' +
                    esc(l.run_id) +
                    '">Details ↗</button></td></tr>'
                  );
                })
                .join("")
            : '<tr><td colspan="6" style="text-align:center;padding:34px;color:#88978b;font-weight:400">' +
              (filter === "all"
                ? "No executions yet. Run a job or let its schedule take over."
                : "No " + filter + " runs in the latest history.") +
              "</td></tr>";
          buttons();
        }
        async function refresh() {
          if (!token || refreshing) return;
          refreshing = true;
          var refreshToken = token;
          try {
            var h = await fetch("/health", { headers: { Authorization: "Bearer " + token } });
            var data = await h.json();
            if (token !== refreshToken) return;
            if (h.status === 401) {
              token = "";
              sessionStorage.removeItem("cron-token");
              $("login").showModal();
            }
            if (!h.ok && data.status !== "degraded")
              throw new Error(data.error || "Connection failed");
            health = data;
            var results = await Promise.all([api("/jobs"), api("/logs")]);
            if (token !== refreshToken) return;
            jobs = results[0];
            logs = results[1];
            lastUpdate = Date.now();
            $("connection").innerHTML =
              '<span class="dot"></span>' +
              (health.status === "ok" ? "Scheduler online" : "Scheduler delayed");
            $("disconnect").hidden = false;
            $("banner").hidden = health.status === "ok";
            $("banner").textContent =
              "A scheduled task is overdue. The scheduler needs attention; automatic runs may be stalled.";
            $("mode-note").innerHTML = health.demoMode
              ? '<span class="mode">Demo mode</span> · Communications are simulated. Scheduling and history are real.'
              : '<span class="mode">Live mode</span> · Running jobs sends real calls, SMS messages and webhooks.';
            var snapshot = JSON.stringify([jobs, logs, health.demoMode]);
            if (snapshot !== lastSnapshot) {
              lastSnapshot = snapshot;
              render();
            } else {
              buttons();
            }
          } catch (e) {
            $("connection").textContent = "Disconnected";
            $("banner").textContent = e.message;
            $("banner").hidden = false;
            health = null;
            buttons();
          } finally {
            refreshing = false;
          }
        }
        async function action(fn) {
          if (busy) return;
          busy = true;
          buttons();
          try {
            await fn();
            await refresh();
          } catch (e) {
            toast(e.message, true);
          } finally {
            busy = false;
            buttons();
          }
        }
        async function seed() {
          await action(async function () {
            if (!health || !health.demoMode) throw new Error("Demo presets require demo mode");
            var presets = [
              {
                id: "demo-call",
                name: "Customer check-in",
                type: "call",
                target: "+18005550102",
                payload: {},
              },
              {
                id: "demo-sms",
                name: "Team reminder",
                type: "sms",
                target: "+18005550102",
                payload: { text: "Your scheduled team check-in is ready." },
              },
              {
                id: "demo-webhook",
                name: "Webhook heartbeat",
                type: "webhook",
                target: "https://example.com/events",
                payload: { event: "heartbeat" },
              },
            ];
            for (var p of presets) {
              if (
                !jobs.some(function (j) {
                  return j.id === p.id;
                })
              )
                await api("/jobs", "POST", Object.assign({ cron: "* * * * *" }, p));
            }
            toast("Three demo jobs are ready. Run one now or watch the next check.");
          });
        }
        $("seed").onclick = seed;
        $("jobs").onclick = function (e) {
          var b = e.target.closest("button");
          if (!b) return;
          if (b.hasAttribute("data-seed")) return seed();
          if (b.hasAttribute("data-create")) return $("create").click();
          if (b.dataset.run)
            action(async function () {
              await api("/jobs/" + b.dataset.run + "/run", "POST");
              toast("Job queued. Watch the execution history.");
            });
          if (b.dataset.delete) {
            var id = b.dataset.delete;
            action(async function () {
              await api("/jobs/" + id, "DELETE");
              toast("Job removed. Its execution history is preserved.");
            });
          }
        };
        $("run-all").onclick = function () {
          action(async function () {
            var eligible = jobs.filter(function (j) {
              return !j.dependsOn.length;
            });
            for (var j of eligible) await api("/jobs/" + j.id + "/run", "POST");
            toast(eligible.length + " jobs queued. Results will appear below.");
          });
        };
        $("fail-demo").onclick = function () {
          action(async function () {
            if (!health.demoMode) throw new Error("Failure demo is available only in demo mode");
            var id = "demo-failure";
            if (
              !jobs.some(function (j) {
                return j.id === id;
              })
            )
              await api("/jobs", "POST", {
                id: id,
                name: "Failure notification",
                cron: "0 9 * * *",
                type: "webhook",
                target: "https://example.com/unavailable",
                demoFailure: true,
              });
            await api("/jobs/" + id + "/run", "POST");
            toast("Failure demo queued. Watch for the simulated SMS alert.");
          });
        };
        $("recording").onclick = function () {
          var on = document.body.classList.toggle("recording");
          this.setAttribute("aria-pressed", String(on));
          this.textContent = on ? "Exit recording view" : "Recording view";
        };
        $("create").onclick = function () {
          $("job-form").reset();
          $("job-error").textContent = "";
          $("custom-cron").hidden = true;
          $("simulate-field").hidden = !health.demoMode;
          updateType();
          $("job-dialog").showModal();
        };
        $("cancel-job").onclick = function () {
          $("job-dialog").close();
        };
        function updateType() {
          var t = $("job-type").value;
          $("target-label").textContent = t === "webhook" ? "Webhook URL" : "Phone number";
          $("job-target").placeholder =
            t === "webhook" ? "https://example.com/events" : "+18005550102";
          $("payload-field").hidden = t === "call";
          $("payload-label").textContent = t === "webhook" ? "JSON payload" : "Message";
          $("job-payload").placeholder =
            t === "webhook" ? '{"event":"heartbeat"}' : "Hello from your scheduler";
        }
        $("job-type").onchange = updateType;
        $("job-schedule").onchange = function () {
          $("custom-cron").hidden = this.value !== "custom";
        };
        $("job-form").onsubmit = async function (e) {
          e.preventDefault();
          var f = new FormData(this);
          try {
            var type = f.get("type"),
              payload = {};
            if (type === "sms") payload = { text: f.get("payload") || "Hello from your scheduler" };
            if (type === "webhook") payload = JSON.parse(f.get("payload") || "{}");
            var job = {
              id: "job-" + crypto.randomUUID().slice(0, 8),
              name: f.get("name"),
              type: type,
              target: f.get("target"),
              cron: f.get("schedule") === "custom" ? f.get("cron") : f.get("schedule"),
              payload: payload,
              demoFailure: health.demoMode && f.get("failure") === "on",
            };
            var submit = this.querySelector("[type=submit]");
            submit.disabled = true;
            await api("/jobs", "POST", job);
            $("job-dialog").close();
            toast("Job created. Your schedule is active.");
            await refresh();
          } catch (err) {
            $("job-error").textContent = err.message;
          } finally {
            this.querySelector("[type=submit]").disabled = false;
          }
        };
        document.querySelectorAll("[data-filter]").forEach(function (b) {
          b.onclick = function () {
            filter = b.dataset.filter;
            document.querySelectorAll("[data-filter]").forEach(function (x) {
              x.classList.toggle("active", x === b);
            });
            render();
          };
        });
        $("history").onclick = function (e) {
          var b = e.target.closest("[data-detail]");
          if (!b) return;
          var row = logs.find(function (l) {
            return l.run_id === b.dataset.detail;
          });
          $("detail-summary").textContent = row.job_id + " · " + row.status;
          $("detail-json").textContent = JSON.stringify(row, null, 2);
          $("detail-dialog").showModal();
        };
        $("close-detail").onclick = function () {
          $("detail-dialog").close();
        };
        $("disconnect").onclick = function () {
          token = "";
          health = null;
          sessionStorage.removeItem("cron-token");
          jobs = [];
          logs = [];
          lastSnapshot = "";
          $("detail-dialog").close();
          $("detail-json").textContent = "";
          $("detail-summary").textContent = "";
          $("connection").textContent = "Disconnected";
          render();
          $("token").value = "";
          $("login").showModal();
          buttons();
        };
        $("connect").onclick = function () {
          $("login").showModal();
        };
        $("login-form").onsubmit = async function (e) {
          e.preventDefault();
          token = $("token").value.trim();
          $("login-error").textContent = "";
          try {
            await api("/jobs");
            sessionStorage.setItem("cron-token", token);
            $("token").value = "";
            $("login").close();
            await refresh();
          } catch (err) {
            $("login-error").textContent = err.message;
          }
        };
        setInterval(function () {
          if (!health) return;
          var task = health.schedules.find(function (t) {
            return t.id === "cron-poll";
          });
          if (task) {
            var seconds = Math.max(0, Math.ceil((task.due - Date.now()) / 1000));
            $("countdown").textContent = seconds
              ? String(Math.floor(seconds / 60)).padStart(2, "0") +
                ":" +
                String(seconds % 60).padStart(2, "0")
              : "Checking…";
            $("next-label").textContent = "Checks every 60 seconds · " + time(task.due);
          }
          $("updated").textContent =
            "Updated " + Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000)) + "s ago";
        }, 250);
        setInterval(refresh, 1500);
        buttons();
        if (token) {
          sessionStorage.setItem("cron-token", token);
          refresh();
        } else {
          $("login").showModal();
        }
      })();
    </script>
  </body>
</html>
`;
}
