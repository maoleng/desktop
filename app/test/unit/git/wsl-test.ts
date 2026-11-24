import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getWSLGitTarget,
  parseWSLDistributions,
  parseWSLGitPreference,
} from '../../../src/lib/git/wsl'

describe('git/wsl', () => {
  const repository = '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\dự án'

  it('reads installed distributions from either WSL output encoding', () => {
    const output = '\ufeffUbuntu-24.04\r\nDistro thử nghiệm\r\n\r\n'
    const expected = ['Ubuntu-24.04', 'Distro thử nghiệm']
    assert.deepEqual(
      parseWSLDistributions(Buffer.from(output, 'utf16le')),
      expected
    )
    assert.deepEqual(
      parseWSLDistributions(Buffer.from(output, 'utf8')),
      expected
    )
    assert.deepEqual(parseWSLDistributions(Buffer.alloc(0)), [])
  })

  it('uses bundled Git for old or invalid preferences', () => {
    for (const value of [null, 'unknown', 'distro:']) {
      assert.equal(parseWSLGitPreference(value), 'windows')
    }
  })

  it('converts both UNC forms to a path in the owning distribution', () => {
    for (const path of [repository, '//wsl$/Ubuntu-24.04/home/user/dự án']) {
      for (const preference of ['auto', 'distro:ubuntu-24.04'] as const) {
        assert.deepEqual(
          getWSLGitTarget(
            ['--no-optional-locks', 'status', '--porcelain=2', '-z'],
            path,
            preference
          ),
          { distribution: 'Ubuntu-24.04', path: '/home/user/dự án' }
        )
      }
    }
  })

  it('keeps bundled Git outside the selected distribution', () => {
    assert.equal(getWSLGitTarget(['status'], repository, 'windows'), null)
    assert.equal(getWSLGitTarget(['status'], repository, 'distro:Debian'), null)
    for (const path of ['C:\\repo', '\\\\server\\share\\repo', 'X:\\repo']) {
      assert.equal(getWSLGitTarget(['status'], path, 'auto'), null)
    }
  })

  it('keeps writes, remote operations, and Windows-valued output on bundled Git', () => {
    const commands = [
      ['add', '--', 'file.txt'],
      ['commit', '-m', 'message'],
      ['fetch', '--', 'origin'],
      ['rev-parse', '--show-toplevel'],
      ['diff', '--output=changes.txt'],
      ['diff', '--no-index', '--', 'C:\\temp\\base', 'C:\\temp\\target'],
    ]
    for (const args of commands) {
      assert.equal(getWSLGitTarget(args, repository, 'auto'), null)
    }
  })

  it('routes the actual diff arguments for an untracked file', () => {
    assert.ok(
      getWSLGitTarget(
        [
          'diff',
          '--no-ext-diff',
          '-z',
          '--no-index',
          '--',
          '/dev/null',
          'dấu cách.txt',
        ],
        repository,
        'auto'
      )
    )
  })
})
