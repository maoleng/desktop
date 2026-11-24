import { execFile } from 'child_process'
import { ExecError, type IGitExecutionOptions, type IGitResult } from 'dugite'
import { win32 } from 'path'
import { execFile as execFileAsync } from '../exec-file'

const preferenceKey = 'wsl-git-distribution'
const distroPrefix = 'distro:'
const wslPath = win32.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'wsl.exe'
)

export type WSLGitPreference = 'windows' | 'auto' | `distro:${string}`

interface IWSLGitTarget {
  readonly distribution: string
  readonly path: string
}

const supportedCommands = new Set([
  'status',
  'diff',
  'log',
  'show',
  'for-each-ref',
  'rev-list',
  'merge-base',
])

/** Interpret a saved selection or a value from the distribution picker. */
export function parseWSLGitPreference(value: string | null): WSLGitPreference {
  if (value === 'auto') {
    return value
  }

  return value?.startsWith(distroPrefix) && value.length > distroPrefix.length
    ? `distro:${value.slice(distroPrefix.length)}`
    : 'windows'
}

/** Load the Windows-only application preference without requiring a renderer. */
export function getWSLGitPreference(): WSLGitPreference {
  return parseWSLGitPreference(
    globalThis.window?.localStorage.getItem(preferenceKey) ?? null
  )
}

/** Save the WSL Git preference for subsequent Git commands. */
export function setWSLGitPreference(preference: WSLGitPreference): void {
  localStorage.setItem(preferenceKey, preference)
}

/** Decode the output of wsl.exe --list --quiet from a redirected stream. */
export function parseWSLDistributions(output: Buffer): ReadonlyArray<string> {
  // Windows versions of wsl.exe can emit UTF-16LE when stdout is redirected.
  const encoding = output.includes(0) ? 'utf16le' : 'utf8'
  return output
    .toString(encoding)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

/** List installed Windows Subsystem for Linux distributions. */
export async function listWSLDistributions(): Promise<ReadonlyArray<string>> {
  const { stdout } = await execFileAsync(wslPath, ['--list', '--quiet'], {
    encoding: 'buffer',
    timeout: 5000,
    windowsHide: true,
  })
  return parseWSLDistributions(stdout)
}

/** Select native Git for supported reads of a repository in its owning distro. */
export function getWSLGitTarget(
  args: ReadonlyArray<string>,
  path: string,
  preference: WSLGitPreference
): IWSLGitTarget | null {
  if (preference === 'windows') {
    return null
  }

  const match =
    /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]+)(?:[\\/](.*))?$/i.exec(path)
  if (match === null) {
    return null
  }

  const [, distribution, relativePath = ''] = match
  if (
    preference !== 'auto' &&
    distribution.toLowerCase() !==
      preference.slice(distroPrefix.length).toLowerCase()
  ) {
    return null
  }

  const commandIndex = args[0] === '--no-optional-locks' ? 1 : 0
  const command = args[commandIndex]
  if (!supportedCommands.has(command)) {
    return null
  }

  const separator = args.indexOf('--', commandIndex + 1)
  const options = args.slice(
    commandIndex + 1,
    separator === -1 ? undefined : separator
  )
  if (
    options.some(
      option => option === '--output' || option.startsWith('--output=')
    )
  ) {
    return null
  }

  // Working-directory diffs use /dev/null for a new file. The conflict
  // editor also uses --no-index, but supplies absolute Windows temp paths.
  if (command === 'diff' && options.includes('--no-index')) {
    const [base, file] = args.slice(separator + 1)
    if (
      separator === -1 ||
      base !== '/dev/null' ||
      file === undefined ||
      win32.isAbsolute(file) ||
      /^[a-z]:/i.test(file)
    ) {
      return null
    }
  }

  return { distribution, path: '/' + relativePath.replaceAll('\\', '/') }
}

/**
 * Execute a read with the distribution's Git. A null result means that the
 * WSL launcher or executable was unavailable, or a partial clone needs the
 * application to fetch an object using its existing credential flow.
 */
export function execWSLGit(
  args: ReadonlyArray<string>,
  target: IWSLGitTarget,
  options: IGitExecutionOptions
): Promise<IGitResult | null> {
  const wslArgs = [
    '--distribution',
    target.distribution,
    '--cd',
    '/',
    '--exec',
    '/usr/bin/env',
    'LC_ALL=C',
    'TERM=dumb',
    'GIT_OPTIONAL_LOCKS=0',
    'GIT_TERMINAL_PROMPT=0',
    'GIT_ALLOW_PROTOCOL=',
    'git',
    '-C',
    target.path,
    '-c',
    'core.fsmonitor=false',
    ...args,
  ]

  return new Promise((resolve, reject) => {
    const child = execFile(
      wslPath,
      wslArgs,
      {
        encoding:
          options.encoding === 'buffer' ? null : options.encoding ?? 'utf8',
        maxBuffer: options.maxBuffer ?? Infinity,
        signal: options.signal,
        killSignal: options.killSignal,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null || typeof error.code === 'number') {
          const exitCode = typeof error?.code === 'number' ? error.code : 0
          if (
            exitCode < 0 ||
            exitCode > 255 ||
            exitCode === 126 ||
            exitCode === 127 ||
            (exitCode === 128 &&
              stderr.toString().includes('from promisor remote'))
          ) {
            log.debug(`[WSL] Falling back to bundled Git (exit ${exitCode})`)
            resolve(null)
          } else {
            resolve({ stdout, stderr, exitCode })
          }
        } else if (error.code === 'ENOENT') {
          log.debug('[WSL] wsl.exe was not found, using bundled Git')
          resolve(null)
        } else {
          reject(new ExecError(error.message, stdout, stderr, error))
        }
      }
    )
    child.stdin?.end()
    options.processCallback?.(child)
  })
}
