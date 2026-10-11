// Ownership guard. Owner: Nishanth. Keeps 4 people from editing each other's files.
//
//   bun tools/guard.ts precommit   -> git pre-commit hook: blocks commits that touch files your branch doesn't own
//   bun tools/guard.ts claude      -> Claude Code PreToolUse hook: blocks Edit/Write outside your branch's files
//   bun tools/guard.ts session     -> Claude Code SessionStart hook: tells Claude who you are and what you own
//   bun tools/guard.ts whoami      -> print your role and files
//
// Branch name -> role: "agent", "data", "backend", "web" (or "data-xyz", "data/xyz", ...).
// On main: nothing may be edited/committed EXCEPT while finishing a merge (MERGE_HEAD exists).

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

type Role = { person: string; github: string; paths: string[] };

const mode = process.argv[2] ?? "whoami";
const root = sh(["git", "rev-parse", "--show-toplevel"]) || process.cwd();
const roles: Record<string, Role> = JSON.parse(readFileSync(join(root, "ownership.json"), "utf8")).roles;
const branch = sh(["git", "branch", "--show-current"]) || "(detached)";
const roleName = Object.keys(roles).find((r) => branch === r || branch.startsWith(`${r}-`) || branch.startsWith(`${r}/`));
const merging = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: root }).exitCode === 0;

function sh(cmd: string[]): string {
  const out = Bun.spawnSync(cmd, { cwd: process.cwd() });
  return out.exitCode === 0 ? out.stdout.toString().trim() : "";
}

function matches(pattern: string, path: string): boolean {
  if (pattern === "**") return true;
  return pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern;
}

function ownerOf(path: string): string | null {
  for (const [name, role] of Object.entries(roles)) if (role.paths.some((p) => matches(p, path))) return `${role.person} (${name} branch)`;
  return null;
}

/** null = allowed, string = reason it's blocked */
function check(path: string): string | null {
  if (/(^|\/)\.env(\..*)?$/.test(path) && !path.endsWith(".env.example")) {
    return mode === "precommit" ? `${path}: secrets files must never be committed.` : null;
  }
  if (branch === "main" || branch === "master") {
    if (merging) return null;
    return `You're on main. Nobody edits main directly. Run: git switch <your branch> (agent | data | backend | web).`;
  }
  if (!roleName) return `Branch "${branch}" isn't a role branch. Use agent, data, backend, or web (see ownership.json).`;
  if (roles[roleName].paths.some((p) => matches(p, path))) return null;
  const owner = ownerOf(path);
  return owner
    ? `${path} is owned by ${owner}. Don't edit it. Write the change you need under "Requests" in team/${roles[roleName].person.toLowerCase()}.md and tell them in the team chat.`
    : `${path} isn't owned by anyone in ownership.json. Ask Nishanth to assign it before creating it.`;
}

if (mode === "precommit") {
  const staged = sh(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRD"]).split("\n").filter(Boolean);
  const problems = staged.map(check).filter((r): r is string => r !== null);
  if (problems.length) {
    console.error("\n✋ Commit blocked by ownership guard:\n" + [...new Set(problems)].map((p) => "  - " + p).join("\n"));
    console.error("\nUnstage those files (git restore --staged <file>) and commit only your own files.\n");
    process.exit(1);
  }
} else if (mode === "claude") {
  const input = JSON.parse((await Bun.stdin.text()) || "{}");
  const filePath: string | undefined = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!filePath) process.exit(0);
  const rel = relative(root, resolve(input.cwd ?? root, filePath));
  if (rel.startsWith("..") || rel.startsWith("node_modules")) process.exit(0); // outside the repo
  const reason = check(rel);
  if (reason) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  }
} else {
  const lines = roleName
    ? [
        `KARL TEAM CONTEXT: this checkout is on branch "${branch}" = the ${roleName.toUpperCase()} role, owned by ${roles[roleName].person}.`,
        `You may ONLY edit: ${roles[roleName].paths.join(", ")}.`,
        `Everything else belongs to a teammate; a hook will block edits there. Follow the git rules in CLAUDE.md. Track progress in team/${roles[roleName].person.toLowerCase()}.md.`,
      ]
    : branch === "main" && !merging
      ? [`KARL TEAM CONTEXT: this checkout is on main. Nobody edits main directly. Before any edit, ask the user which role they are and switch: git switch agent|data|backend|web (create it from main with git switch -c if it doesn't exist).`]
      : [`KARL TEAM CONTEXT: branch "${branch}"${merging ? " (merge in progress: all files editable to resolve conflicts)" : " is not a role branch; see ownership.json"}.`];
  if (!existsSync(join(root, ".githooks/pre-commit"))) lines.push("Warning: .githooks/pre-commit missing.");
  console.log(lines.join("\n"));
}
