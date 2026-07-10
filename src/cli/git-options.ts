import type { BranchContextOptions } from "../git/context/model.js";
import { hasOption, optionValue, type ParsedCliArgs } from "./args.js";

type InertJsonFlag = "--branch-diff" | "--diff";

/** CLI output mode, collection overrides, and text-only JSON warnings. */
export interface GitCliInvocation {
  readonly json: boolean;
  readonly options: Partial<BranchContextOptions>;
  readonly inertJsonFlags: readonly InertJsonFlag[];
}

/** Translate validated CLI arguments into git-context collection options. */
export function gitCliInvocation(args: ParsedCliArgs): GitCliInvocation {
  const json = hasOption(args, "--json");
  const diff = hasOption(args, "--diff");
  const branchDiff = hasOption(args, "--branch-diff");
  const inertJsonFlags: InertJsonFlag[] = [];
  if (json && diff) inertJsonFlags.push("--diff");
  if (json && branchDiff) inertJsonFlags.push("--branch-diff");

  return {
    json,
    inertJsonFlags,
    options: {
      diff: !json && diff,
      branchDiff: !json && branchDiff,
      since: optionValue(args, "--since"),
      description: !hasOption(args, "--no-description"),
      labels: hasOption(args, "--labels"),
      comments: hasOption(args, "--comments"),
      reviews: hasOption(args, "--reviews"),
      checks: hasOption(args, "--checks"),
      pullRequest: !hasOption(args, "--no-pr"),
      branchMetadata: !hasOption(args, "--no-branch-metadata"),
      remoteDetails: hasOption(args, "--remotes"),
      status: !hasOption(args, "--no-status"),
      workScope: !hasOption(args, "--no-work-scope"),
    },
  };
}
