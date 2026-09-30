#!/usr/bin/env node
/**
 * Runs Codex (the owner's local CLI and ChatGPT sign-in, no API key) on pull requests: a code review,
 * and a browser UI QA run against the PR's app started with Docker Compose. Each posts one PR comment
 * that is updated on every new head. See .github/codex/README.md.
 *
 *   pnpm codex:pr run 63             review and QA one PR (QA only when it touches the app)
 *   pnpm codex:pr run 63 --only qa   one of the two
 *   pnpm codex:pr run 63 --no-post   keep the reports local
 *   pnpm codex:pr watch              every open PR, again on each new push; polls every 5 minutes
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: 'string' },
    'no-post': { type: 'boolean', default: false },
    interval: { type: 'string', default: '5' },
  },
});

const isWindows = process.platform === 'win32';
const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
/** Prompts and the QA compose override come from the runner's checkout, so PRs that predate them work. */
const codexDir = join(repoRoot, '.github', 'codex');
const workRoot = resolve(process.env.CODEX_PR_DIR || join(homedir(), 'ailab-review'));
const model = process.env.CODEX_MODEL || 'gpt-6.1-sol';
const reviewEffort = process.env.CODEX_REVIEW_EFFORT || 'high';
const qaEffort = process.env.CODEX_QA_EFFORT || 'medium';
const playwrightMcp = '@playwright/mcp@0.0.83';
/** Paths whose changes can change what a person sees, so they get a browser QA run. */
const APP_PATHS = /^(apps|packages|seed)\/|^compose\.yaml$|^pnpm-lock\.yaml$/;
const QA_USER = { email: 'qa@lab.local', password: 'qa-only-password' };

const [command, prArg] = positionals;
mkdirSync(workRoot, { recursive: true });
const codex = findCodex();
const repo = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();

if (command === 'run' && prArg) {
  await runPr(Number(prArg), values.only);
} else if (command === 'watch') {
  await watch(Number(values.interval) * 60_000);
} else {
  console.error('Usage: pnpm codex:pr run <number> [--only review|qa] [--no-post] | watch');
  process.exit(1);
}

async function watch(everyMs) {
  const statePath = join(workRoot, 'state.json');
  const done = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  console.log(`Watching ${repo} for new pushes every ${everyMs / 60_000} min. Ctrl+C stops.`);
  for (;;) {
    const open = JSON.parse(
      run('gh', [
        'pr',
        'list',
        '--limit',
        '1000',
        '--state',
        'open',
        '--json',
        'number,headRefOid,labels,isCrossRepository',
      ]),
    );
    for (const pr of open) {
      if (pr.isCrossRepository || pr.labels.some((l) => l.name === 'skip-codex')) continue;
      if (done[pr.number] === pr.headRefOid) continue;
      // Only a finished run counts, so a failed one is tried again on the next poll.
      try {
        await runPr(pr.number);
        done[pr.number] = pr.headRefOid;
        writeFileSync(statePath, JSON.stringify(done, null, 2));
      } catch (error) {
        console.error(`PR #${pr.number}: ${error.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function runPr(number, only) {
  const pr = JSON.parse(
    run('gh', [
      'pr',
      'view',
      String(number),
      '--json',
      'title,body,baseRefName,headRefOid,state,files',
    ]),
  );
  const sha = pr.headRefOid.slice(0, 7);
  if (pr.state !== 'OPEN')
    throw new Error(`PR #${number} is ${pr.state.toLowerCase()}; nothing to review`);
  console.log(`PR #${number} at ${sha}: ${pr.title}`);

  // A detached worktree at the PR's head, next to (never inside) the lab's own checkouts.
  const dir = join(workRoot, `pr-${number}`);
  git(['fetch', '--quiet', 'origin', pr.baseRefName, `pull/${number}/head`], repoRoot);
  git(['worktree', 'prune'], repoRoot);
  if (existsSync(dir)) git(['worktree', 'remove', '--force', dir], repoRoot);
  git(['worktree', 'add', '--detach', dir, pr.headRefOid], repoRoot);

  const range = `origin/${pr.baseRefName}...HEAD`;
  mkdirSync(join(dir, '.codex-pr'), { recursive: true });
  writeFileSync(join(dir, '.codex-pr', 'pr.diff'), git(['diff', range], dir));
  writeFileSync(join(dir, '.codex-pr', 'pr.stat'), git(['diff', '--stat', range], dir));
  writeFileSync(join(dir, '.codex-pr', 'description.md'), `# ${pr.title}\n\n${pr.body}\n`);
  const changed = pr.files.map((file) => file.path);

  if (!only || only === 'review') {
    const report = await codexExec(
      dir,
      'review',
      readFileSync(join(codexDir, 'review.md'), 'utf8'),
      ['-c', `model_reasoning_effort=${reviewEffort}`],
    );
    await post(number, 'codex-review', 'Codex review', report, `Reviewed ${sha}`);
  }
  if (!only || only === 'qa') {
    if (!changed.some((path) => APP_PATHS.test(path))) {
      console.log('  UI QA skipped: the PR does not touch the app.');
    } else {
      const report = await uiQa(number, dir);
      await post(number, 'codex-ui-qa', 'UI QA', report, `Tested ${sha} in a browser`);
    }
  }
}

/** Starts the PR's app as its own compose project, loads the seed lab, and lets Codex test it. */
async function uiQa(number, dir) {
  const files = join(dir, '.qa-files');
  const shots = join(dir, 'qa-shots');
  mkdirSync(files, { recursive: true });
  mkdirSync(shots, { recursive: true });
  const ports = {
    QA_DB_PORT: '15432',
    QA_API_PORT: '13001',
    QA_SCIENCE_PORT: '18001',
    QA_WEB_PORT: '18080',
  };
  const env = {
    ...process.env,
    ...ports,
    QA_FILES_DIR: files,
    QA_AGENT_PROVIDER: process.env.QA_OPENROUTER_API_KEY ? 'openrouter' : '',
    DATABASE_URL: `postgres://ailab:ailab-dev-only@localhost:${ports.QA_DB_PORT}/ailab`,
    SCIENCE_URL: `http://localhost:${ports.QA_SCIENCE_PORT}`,
    FILE_STORE_DIR: files,
    BOOTSTRAP_ORG: 'Demo Org',
    BOOTSTRAP_LAB: 'Demo Lab',
    BOOTSTRAP_USER: 'QA tester',
    BOOTSTRAP_EMAIL: QA_USER.email,
    BOOTSTRAP_PASSWORD: QA_USER.password,
  };
  const compose = [
    'compose',
    '-p',
    `ailab-qa-${number}`,
    '-f',
    'compose.yaml',
    '-f',
    join(codexDir, 'compose.qa.yaml'),
  ];
  const web = `http://localhost:${ports.QA_WEB_PORT}`;
  try {
    console.log('  Starting the app (docker compose)...');
    run('docker', [...compose, 'down', '-v'], { cwd: dir, env, check: false });
    run('docker', [...compose, 'up', '-d', '--build', '--wait'], { cwd: dir, env, inherit: true });
    await waitFor(`http://localhost:${ports.QA_API_PORT}/health`);
    await waitFor(web);
    console.log('  Installing, creating the lab and loading the seed...');
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, env, inherit: true });
    run('pnpm', ['--filter', '@ailab/api', 'bootstrap'], { cwd: dir, env });
    run('pnpm', ['--filter', '@ailab/api', 'seed'], { cwd: dir, env, inherit: true });

    const prompt = readFileSync(join(codexDir, 'ui-qa.md'), 'utf8')
      .replaceAll('{{WEB_URL}}', web)
      .replaceAll('{{EMAIL}}', QA_USER.email)
      .replaceAll('{{PASSWORD}}', QA_USER.password);
    const mcpArgs = [
      '-y',
      playwrightMcp,
      '--headless',
      '--isolated',
      '--viewport-size=1440x900',
      `--output-dir=${shots}`,
    ];
    return await codexExec(dir, 'ui-qa', prompt, [
      '-c',
      `model_reasoning_effort=${qaEffort}`,
      '-c',
      'mcp_servers.playwright.command="npx"',
      '-c',
      `mcp_servers.playwright.args=${JSON.stringify(mcpArgs)}`,
      '-c',
      'mcp_servers.playwright.startup_timeout_sec=120',
      '-c',
      'mcp_servers.playwright.tool_timeout_sec=120',
      '-c',
      'mcp_servers.playwright.default_tools_approval_mode="approve"',
    ]);
  } finally {
    const logs = run('docker', [...compose, 'logs', 'api', 'web', 'science'], {
      cwd: dir,
      env,
      check: false,
    });
    writeFileSync(join(shots, 'stack.log'), logs);
    run('docker', [...compose, 'down', '-v'], { cwd: dir, env, check: false });
    console.log(`  Screenshots and stack log: ${shots}`);
  }
}

/** Runs `codex exec` read-only with the prompt on stdin; returns its final message. */
function codexExec(dir, name, prompt, extra) {
  const out = join(workRoot, `${name}-${Date.now()}.md`);
  const args = [
    'exec',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '-m',
    model,
    ...extra,
    '-o',
    out,
    '-',
  ];
  console.log(`  Codex ${name} (${model})...`);
  const started = Date.now();
  return new Promise((done, fail) => {
    const child = spawn(codex, args, { cwd: dir, stdio: ['pipe', 'ignore', 'inherit'] });
    child.stdin.end(prompt);
    child.on('error', fail);
    child.on('close', (code) => {
      const minutes = ((Date.now() - started) / 60_000).toFixed(1);
      if (code !== 0 || !existsSync(out)) return fail(new Error(`codex ${name} exited ${code}`));
      console.log(`  Codex ${name} done in ${minutes} min: ${out}`);
      const report = readFileSync(out, 'utf8').trim();
      rmSync(out);
      done(report);
    });
  });
}

/** Creates or updates this run's one comment on the PR, found by its marker. */
async function post(number, key, heading, report, footer) {
  if (values['no-post']) {
    const path = join(workRoot, `pr-${number}-${key}.md`);
    writeFileSync(path, report);
    console.log(`  Not posted: ${path}`);
    return;
  }
  const marker = `<!-- ${key} -->`;
  const body = `${marker}\n## ${heading}\n\n${report}\n\n---\n_${footer} · Codex ${model}, run locally_`;
  const comments = JSON.parse(
    run('gh', ['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/comments`]),
  ).flat();
  const mine = comments.find((c) => c.body?.startsWith(marker));
  const input = join(workRoot, `comment-${number}.json`);
  writeFileSync(input, JSON.stringify({ body }));
  const path = mine
    ? ['-X', 'PATCH', `repos/${repo}/issues/comments/${mine.id}`]
    : ['-X', 'POST', `repos/${repo}/issues/${number}/comments`];
  run('gh', ['api', ...path, '--input', input]);
  rmSync(input);
  console.log(`  Posted ${heading} on #${number}`);
}

/** CODEX_BIN, else `codex` on PATH, else the CLI inside the Windows Codex app (its path changes on update). */
function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (!isWindows) {
    if (spawnSync('codex', ['--version']).status === 0) return 'codex';
  } else {
    // A native codex.exe on PATH; npm's codex.cmd shim can't be spawned without a shell, which
    // would mangle the quoted -c arguments.
    const onPath = spawnSync('where', ['codex.exe'], { encoding: 'utf8' }).stdout?.split(
      /\r?\n/,
    )[0];
    if (onPath && existsSync(onPath)) return onPath;
    const where = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', '(Get-AppxPackage OpenAI.Codex).InstallLocation'],
      { encoding: 'utf8' },
    ).stdout?.trim();
    const exe = where && join(where, 'app', 'resources', 'codex.exe');
    if (exe && existsSync(exe)) return exe;
  }
  console.error('Codex CLI not found. Install it, or set CODEX_BIN to its path.');
  process.exit(1);
}

function git(args, cwd) {
  return run('git', args, { cwd });
}

/** Runs a command and returns stdout; .cmd shims (pnpm, npx) need a shell on Windows. */
function run(cmd, args, { cwd = repoRoot, env = process.env, inherit = false, check = true } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: isWindows && cmd === 'pnpm',
    stdio: inherit ? ['ignore', 'inherit', 'inherit'] : 'pipe',
  });
  if (check && result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

async function waitFor(url, seconds = 180) {
  for (let i = 0; i < seconds / 2; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${url} did not come up`);
}
