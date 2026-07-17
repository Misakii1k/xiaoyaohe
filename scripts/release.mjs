import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publishReleaseArtifacts,
  readAndValidateReleaseConfig,
  resolveAndroidArtifact,
} from './lib/release-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `Usage: npm run release -- [options]

Options:
  --skip-install              Skip npm ci for an already prepared local workspace
  --android-variant <name>    Gradle APK variant (default: debug)
  --dry-run                   Validate configuration and print commands only
  --help                      Show this help`;
}

export function parseReleaseArgs(args) {
  const options = {
    skipInstall: false,
    variant: 'debug',
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--skip-install') options.skipInstall = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--android-variant') {
      options.variant = args[index + 1];
      index += 1;
      if (!options.variant) throw new Error('--android-variant requires a value.');
    } else if (argument.startsWith('--android-variant=')) {
      options.variant = argument.slice('--android-variant='.length);
    } else {
      throw new Error(`Unknown release option: ${argument}`);
    }
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options.variant)) {
    throw new Error(`Invalid Android variant: ${options.variant}`);
  }
  return options;
}

export function createReleaseCommands({ skipInstall, variant }) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const gradleVariant = `${variant[0].toUpperCase()}${variant.slice(1)}`;
  const commands = [];
  if (!skipInstall) commands.push({ label: 'Install locked dependencies', command: npm, args: ['ci'] });
  commands.push(
    { label: 'Audit all dependencies', command: npm, args: ['audit', '--audit-level=low'] },
    { label: 'Type-check frontend', command: npm, args: ['run', 'typecheck'] },
    { label: 'Type-check Worker', command: npm, args: ['run', 'typecheck:worker'] },
    { label: 'Run Vitest suite', command: npm, args: ['test'] },
    { label: 'Install Playwright Chromium', command: npx, args: ['playwright', 'install', 'chromium'] },
    { label: 'Run Playwright visual matrix', command: npx, args: ['playwright', 'test'] },
    { label: 'Build web application', command: npm, args: ['run', 'build:web'] },
    { label: 'Validate Worker deployment bundle', command: npx, args: ['wrangler', 'deploy', '--dry-run'] },
    { label: 'Sync Capacitor Android project', command: npx, args: ['cap', 'sync', 'android'] },
    {
      label: 'Run Android unit tests and assemble APK',
      command: gradle,
      args: [`test${gradleVariant}UnitTest`, `assemble${gradleVariant}`],
      cwd: resolve(root, 'android'),
    },
  );
  commands.push({
    label: 'Run Android instrumentation tests',
    command: gradle,
    args: [`connected${gradleVariant}AndroidTest`],
    cwd: resolve(root, 'android'),
  });
  return commands;
}

function displayCommand(step) {
  return [step.command, ...step.args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

export function requiresCommandShell(command, platform = process.platform) {
  return platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
}

export function resolveReleaseCommand(step, platform = process.platform, commandShell = process.env.ComSpec || 'cmd.exe') {
  if (!requiresCommandShell(step.command, platform)) {
    return { command: step.command, args: step.args };
  }

  const parts = [step.command, ...step.args];
  if (parts.some((part) => !/^[A-Za-z0-9._:/=,@+\-]+$/.test(part))) {
    throw new Error(`Unsafe Windows release command argument: ${parts.find((part) => !/^[A-Za-z0-9._:/=,@+\-]+$/.test(part))}`);
  }
  return {
    command: commandShell,
    args: ['/d', '/s', '/c', parts.join(' ')],
  };
}

function runStep(step, position, total, dryRun) {
  console.log(`\n[${position}/${total}] ${step.label}`);
  console.log(`> ${displayCommand(step)}`);
  if (dryRun) return;

  const invocation = resolveReleaseCommand(step);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: step.cwd ?? root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${step.label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

export function runRelease(args = process.argv.slice(2)) {
  const options = parseReleaseArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }

  const config = readAndValidateReleaseConfig(root);
  console.log(`Release configuration: ${config.name} ${config.version} (Android ${config.versionCode})`);
  const commands = createReleaseCommands(options);
  commands.forEach((step, index) => runStep(step, index + 1, commands.length, options.dryRun));

  if (options.dryRun) {
    console.log('\nDry run complete. Artifact checks run only after a real build.');
    return;
  }

  console.log('\n[verify] Validate APK metadata and embedded web resources');
  const apkFile = resolveAndroidArtifact(root, options.variant, config);
  const artifacts = publishReleaseArtifacts({
    root,
    releaseConfig: config,
    variant: options.variant,
    apkFile,
  });

  console.log(
    `Verified ${artifacts.verification.fileCount} embedded files ` +
      `(aggregate ${artifacts.verification.aggregateHash}).`,
  );
  console.log('Release artifacts:');
  console.log(`- ${artifacts.webArchive}`);
  console.log(`- ${artifacts.androidArtifact}`);
  console.log(`- ${artifacts.checksumFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runRelease();
  } catch (error) {
    console.error(`\nRelease failed: ${error.message}`);
    process.exitCode = 1;
  }
}
