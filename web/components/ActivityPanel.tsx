import type { ActivityRun, ActivityStep } from "../lib/types";

// "1.2s" between this step and the one before it (the first step counts from the run start).
function elapsed(run: ActivityRun, i: number): string | null {
  const step = run.steps[i];
  const prev = i === 0 ? run.startedAt : run.steps[i - 1].at;
  if (step.status !== "done" || !step.at || !prev) return null;
  const sec = Math.max(0, (Date.parse(step.at) - Date.parse(prev)) / 1000);
  return `${sec.toFixed(1)}s`;
}

function icon(status: ActivityStep["status"]): string {
  if (status === "done") return "✓";
  if (status === "failed") return "✕";
  return "";
}

function headline(run: ActivityRun): string {
  const item = run.itemTitle ?? (run.kind === "sell" ? "an item" : "something");
  if (run.kind === "sell") return `${run.firstName} is selling ${item}`;
  // No match yet: Karl saved the want and will text them when one is listed.
  const wantSaved = run.steps.some((s) => s.key === "want_saved" && s.status === "done");
  if (wantSaved) return `${run.firstName} wants ${item}. Karl will text when one is listed`;
  return `${run.firstName} is looking for ${item}`;
}

export default function ActivityPanel({ run, simulated }: { run: ActivityRun | null; simulated: boolean }) {
  return (
    <section className="card activity">
      <div className="activity-head">
        <h2>Karl right now</h2>
        <span className={`activity-badge ${simulated ? "sim" : "real"}`}>{simulated ? "simulated demo" : "● live"}</span>
      </div>
      {run ? (
        <>
          <p className="activity-title">{headline(run)}</p>
          <ol className="steps">
            {run.steps.map((step, i) => (
              <li key={step.key} className={`step ${step.status}`}>
                <div className="step-box">
                  <span className="step-icon">{icon(step.status)}</span>
                  <span className="step-label">{step.label}</span>
                </div>
                <div className="step-time">{elapsed(run, i)}</div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="muted">Waiting for a text… scan the QR to try Karl</p>
      )}
    </section>
  );
}
