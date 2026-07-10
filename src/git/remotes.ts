/** A resolved default remote plus the full list of configured remotes. */
export interface ResolvedRemote {
  /** Chosen remote name (upstream > origin > first available), if configured. */
  readonly remote: string | null;
  /** All configured remote names, in `git remote` order. */
  readonly remotes: readonly string[];
}

/** Resolve the default remote from `git remote` output. */
export function resolveDefaultRemote(remotesOutput: string): ResolvedRemote {
  const remotes = remotesOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const remote = remotes.includes("upstream")
    ? "upstream"
    : remotes.includes("origin")
      ? "origin"
      : (remotes[0] ?? null);
  return { remote, remotes };
}

/** Parse `git symbolic-ref refs/remotes/<remote>/HEAD` output. */
export function parseDefaultBranch(ref: string, remote: string): string | null {
  const prefix = `refs/remotes/${remote}/`;
  if (!ref.startsWith(prefix)) return null;
  return ref.slice(prefix.length) || null;
}
