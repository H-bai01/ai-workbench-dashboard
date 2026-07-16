export interface ParsedOpenClawVersion {
  text: string
  parts: number[]
  prerelease: string
}

export interface OpenClawReleaseVersion {
  version: string
  name?: string
  description?: string
  publishedAt?: string
  prerelease?: boolean
  htmlUrl?: string
}

export function parseOpenClawVersion(value: unknown): ParsedOpenClawVersion | null
export function compareOpenClawVersions(left: unknown, right: unknown): number
export function latestStableOpenClawVersion<T extends OpenClawReleaseVersion>(versions: T[]): T | null
export function createOpenClawUpdateStatus<T extends OpenClawReleaseVersion>(
  currentVersion: unknown,
  versions: T[],
  extra?: Record<string, unknown>,
): {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  latestRelease: T | null
} & Record<string, unknown>
