// deploy/after-release.sh against local stand-ins of digita-deploy and digita-translations. Git's
// url.<base>.insteadOf points the script's GitHub addresses at bare repositories in a scratch
// directory, and the stand-in translations-promote.sh only prints what it was handed, so these tests
// stop at the decision and push nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "after-release.sh");
const author = ["-c", "user.name=test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false"];

function git(cwd, ...args) {
  return execFileSync("git", [...author, ...args], { cwd, encoding: "utf8" }).trim();
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commitAll(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

/** A world of three repositories. `deleted` maps a translations folder to the keys its next commit
 *  drops; `source` is what packages/engine/src/codes.ts of the released commit says. */
function world({ deleted = {}, source = "export const codes = [];\n", pinTheHead = false, subject = "Raise a code (#7)", extraKeys = [], badBaseline = false, missingPin = false, missingTarget = false, noIncludes = false, shallow = false }) {
  const root = mkdtempSync(join(tmpdir(), "after-release-"));

  const translations = join(root, "translations");
  mkdirSync(translations);
  git(translations, "init", "-q", "-b", "master");
  const folders = ["digita-engine", "digita-auth-frontend"];
  const full = { "digita-engine": ["doc_saved", "page_gone", "unread_gone", ...extraKeys], "digita-auth-frontend": ["login", "auth_gone"] };
  for (const folder of folders) {
    write(translations, `translations/${folder}/en.json`, JSON.stringify(Object.fromEntries(full[folder].map((key) => [key, key]))));
  }
  if (badBaseline) write(translations, "translations/digita-engine/en.json", "{");
  const pin = commitAll(translations, "texts");
  for (const folder of folders) {
    const kept = full[folder].filter((key) => !(deleted[folder] ?? []).includes(key));
    write(translations, `translations/${folder}/en.json`, JSON.stringify(Object.fromEntries([...kept, "added"].map((key) => [key, key]))));
  }
  if (missingTarget) rmSync(join(translations, "translations/digita-engine/en.json"));
  const head = commitAll(translations, "more texts");

  const deploy = join(root, "deploy");
  mkdirSync(deploy);
  git(deploy, "init", "-q", "-b", "master");
  for (const folder of folders) {
    write(deploy, `charts/${folder}/templates/init.yaml`, noIncludes ? "# no translations init\n" : `{{ include "digita-lib.translationsInit" (dict "build" "${folder}") }}\n`);
    write(deploy, `charts/${folder}/values-prod.yaml`, `image: x\ntranslations:\n  commit: "${missingPin ? "1".repeat(40) : pinTheHead ? head : pin}"\nother: y\n`);
  }
  write(deploy, "scripts/translations-promote.sh", 'echo "PROMOTE $*"\n');
  commitAll(deploy, "charts");

  const platform = join(root, "platform");
  mkdirSync(platform);
  git(platform, "init", "-q", "-b", "master");
  write(platform, "README.md", "x\n");
  commitAll(platform, "Start (#1)");
  git(platform, "tag", "0.0.1-stable-20260101000000");
  write(platform, "packages/engine/src/codes.ts", source);
  cpSync(script, join(platform, "deploy/after-release.sh"));
  const release = commitAll(platform, subject);

  for (const [name, path] of [["translations", translations], ["deploy", deploy]]) {
    execFileSync("git", ["clone", "-q", "--bare", path, join(root, `${name}.git`)]);
  }
  let runPlatform = platform;
  if (shallow) {
    runPlatform = join(root, "shallow-platform");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${platform}`, runPlatform]);
  }
  return { root, platform: runPlatform, release, pin, head };
}

function run(w, { stage = "prod", env = {}, subdirectory = false } = {}) {
  const rewrite = {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `url.file://${w.root}/deploy.git.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/digitaplatform/digita-deploy.git",
    GIT_CONFIG_KEY_1: `url.file://${w.root}/translations.git.insteadOf`,
    GIT_CONFIG_VALUE_1: "https://github.com/digitaplatform/digita-translations.git",
  };
  const result = spawnSync("bash", [join(w.platform, "deploy/after-release.sh"), "0.0.2-stable-20260102000000", w.release, stage], {
    cwd: subdirectory ? join(w.platform, "deploy") : w.platform,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", ...rewrite, ...env },
  });
  rmSync(w.root, { recursive: true, force: true });
  return result;
}

test("PLANTED DEFECT: a deleted key that the released code still reads stops the promote and names its reader", () => {
  const result = run(world({ deleted: { "digita-engine": ["page_gone"] }, source: 'export const codes = ["page_gone"];\n' }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /digita-engine: page_gone is read at packages\/engine\/src\/codes\.ts:1/);
  assert.doesNotMatch(result.stdout, /PROMOTE/);
});

test("PLANTED INNOCENT: a deleted key without a reader promotes the stage to the head, naming the release's issue", () => {
  const w = world({ deleted: { "digita-engine": ["unread_gone"] }, source: 'export const codes = ["unread_gone_longer"];\n' });
  const result = run(w);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`PROMOTE prod ${w.head} --issue digitaplatform/digita-platform#7$`, "m"));
});

test("PLANTED DEFECT: a deleted key of another repository's texts stops the promote, naming that repository and the command for after its check", () => {
  const w = world({ deleted: { "digita-auth-frontend": ["auth_gone"] } });
  const result = run(w);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /digita-auth-frontend: auth_gone may be read by digitaplatform\/digita-auth/);
  assert.match(result.stderr, new RegExp(`promote from a digita-deploy checkout at the master of origin: bash scripts/translations-promote\\.sh prod ${w.head} --issue digitaplatform/digita-platform#7$`, "m"));
  assert.doesNotMatch(result.stdout, /PROMOTE/);
});

test("matching pins still delegate completion, so a failed stage-tag push can be repaired", () => {
  const w = world({ pinTheHead: true });
  const result = run(w);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`PROMOTE prod ${w.head} --issue digitaplatform/digita-platform#7$`, "m"));
});

test("a library release moves no stage", () => {
  const result = run(world({}), { stage: "none" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /a library release deploys nothing/);
});

test("in the Release workflow it stops before anything and names the command to run elsewhere", () => {
  const w = world({});
  const result = run(w, { env: { GITHUB_ACTIONS: "true" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`run: bash deploy/after-release\\.sh 0\\.0\\.2-stable-20260102000000 ${w.release} prod$`, "m"));
});

test("a release whose commits name no issue stops, because the pin commit must name one", () => {
  const result = run(world({ subject: "Raise a code" }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /names an issue in its subject or body/);
});

test("a reader is still found when the hook is called from its deploy directory", () => {
  const w = world({ deleted: { "digita-engine": ["page_gone"] }, source: 'export const codes = ["page_gone"];\n' });
  const result = run(w, { subdirectory: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /page_gone is read at packages\/engine\/src\/codes\.ts:1/);
  assert.doesNotMatch(result.stdout, /PROMOTE/);
});

test("a whitespace key keeps its complete reader name", () => {
  const key = "option.Log.action.Password Changed";
  const result = run(world({ extraKeys: [key], deleted: { "digita-engine": [key] }, source: `export const codes = ["${key}"];\n` }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /option\.Log\.action\.Password Changed is read at/);
  assert.doesNotMatch(result.stdout, /PROMOTE/);
});

test("an unread whitespace key is not held by an unrelated word fragment", () => {
  const key = "option.Log.action.Password Changed";
  const result = run(world({ extraKeys: [key], deleted: { "digita-engine": [key] }, source: 'export const codes = ["Changed"];\n' }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PROMOTE prod/);
});

test("multiple and body references keep their owning repositories and appear once", () => {
  const result = run(world({ subject: "Raise a code (#7, #8)\n\nRefs digitaplatform/digita-catalog#98, digita-report#47, #7" }));
  assert.equal(result.status, 0, result.stderr);
  for (const ref of ["digitaplatform/digita-platform#7", "digitaplatform/digita-platform#8", "digitaplatform/digita-catalog#98", "digitaplatform/digita-report#47"]) assert.ok(result.stdout.includes(`--issue ${ref}`), ref);
  assert.equal((result.stdout.match(/--issue /g) ?? []).length, 4);
  assert.doesNotMatch(result.stdout, /digitaplatform\/digita-platform#98/);
});

for (const option of ["badBaseline", "missingPin"]) {
  test(`an unreadable baseline (${option}) refuses before promotion`, () => {
    const result = run(world({ [option]: true }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /REFUSED.*cannot check translations\/[^ ]+\/en\.json at pinned commit/);
    assert.doesNotMatch(result.stdout, /PROMOTE/);
    assert.doesNotMatch(result.stderr, /SyntaxError|at JSON\.parse/);
  });
}

test("a missing target translation file refuses before promotion", () => {
  const result = run(world({ missingTarget: true }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REFUSED.*cannot check .* at target commit/);
  assert.doesNotMatch(result.stdout, /PROMOTE/);
});

test("no translation includes produces an explicit refusal", () => {
  const result = run(world({ noIncludes: true }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REFUSED.*no chart of digita-deploy names/);
  assert.doesNotMatch(result.stdout, /PROMOTE/);
});

test("a shallow checkout refuses an unprovable release range", () => {
  const result = run(world({ shallow: true }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REFUSED.*checkout is shallow/);
  assert.doesNotMatch(result.stdout, /PROMOTE/);
});
