import * as React from 'react'
import {
  listWSLDistributions,
  parseWSLGitPreference,
  type WSLGitPreference,
} from '../../lib/git/wsl'
import { Select } from '../lib/select'

interface IWSLGitSettingsProps {
  readonly preference: WSLGitPreference
  readonly onPreferenceChanged: (value: WSLGitPreference) => void
}

/** The selection of which WSL distributions use native Git for local reads. */
export function WSLGitSettings({
  preference,
  onPreferenceChanged,
}: IWSLGitSettingsProps) {
  const [distributions, setDistributions] =
    React.useState<ReadonlyArray<string> | null>(null)

  React.useEffect(() => {
    let active = true
    listWSLDistributions()
      .catch(error => {
        log.debug('[WSL] Could not list distributions', error)
        return []
      })
      .then(result => {
        if (active) {
          setDistributions(result)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const options = (distributions ?? []).map(name => ({
    name,
    value: `distro:${name}`,
  }))
  const missingDistribution =
    preference.startsWith('distro:') &&
    !options.some(option => option.value === preference)

  const onChange = React.useCallback(
    (event: React.FormEvent<HTMLSelectElement>) =>
      onPreferenceChanged(parseWSLGitPreference(event.currentTarget.value)),
    [onPreferenceChanged]
  )

  return (
    <>
      <Select
        label="Git for WSL repositories"
        value={preference}
        onChange={onChange}
      >
        <option value="windows">Git bundled with GitHub Desktop</option>
        <option value="auto">Use each repository's WSL distribution</option>
        {options.map(({ name, value }) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
        {missingDistribution && (
          <option value={preference}>
            {preference.slice('distro:'.length)}
            {distributions !== null ? ' (unavailable)' : ''}
          </option>
        )}
      </Select>
      <p className="settings-description">
        Use Git installed in the selected distribution to load Changes, diffs,
        branches, and history. Repositories in other locations, commits, and
        network operations use the Git bundled with GitHub Desktop.
      </p>
      <div role="status" className="settings-description">
        {distributions === null
          ? 'Finding WSL distributions…'
          : distributions.length === 0
          ? 'No WSL distributions were detected.'
          : null}
      </div>
    </>
  )
}
