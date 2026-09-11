/**
 * Shared child-session transcript evidence extraction.
 *
 * Two consumers need "what did the child session end with?":
 * - `revived-run-tracker` (revive probes, strict v1 transcript shape)
 * - the quiescent host-outcome settle path in `task-session-manager`
 *   (v2 shim shape — `info` carries only `{id, role}`; terminality is
 *   confirmed upstream via `Session.Info.outcome`)
 *
 * Both previously carried their own (and subtly different) extraction
 * logic. This module is the single source of truth for reading a v1-style
 * `{data: [{info, parts}]}` messages response and classifying the
 * trailing assistant turn.
 */

interface ChildTranscriptOptions {
  /** Only consider messages after this baseline message id (revive flow). */
  baselineMessageID?: string;
  /** Require `info.time.completed` on the trailing assistant (v1 hosts
   * always provide it once the turn finalizes). Defaults to true; v2
   * shim shapes pass false because the flat mapping drops `time` —
   * terminality there is confirmed via the host outcome gate before
   * this extractor runs. */
  requireCompletionTime?: boolean;
  /** When the ABSOLUTE trailing message is not an assistant, scan
   * backward for the last assistant and classify that message instead.
   * v2 sessions can carry structurally valid non-assistant tails
   * (synthetic/system/skill); the default (false) keeps the strict
   * trailing-message semantics the revive probe relies on. */
  scanBackToLastAssistant?: boolean;
}

export type ChildTerminalEvidence =
  | { kind: 'ready'; text: string }
  | { kind: 'textless' }
  | { kind: 'pending' }
  | { kind: 'error'; errorText: string }
  | { kind: 'no-assistant' }
  | { kind: 'no-new-messages' };

interface LooseMessage {
  info?: {
    id?: unknown;
    role?: unknown;
    error?: unknown;
    finish?: unknown;
    time?: { completed?: unknown };
  };
  parts?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function extractChildTerminalEvidence(
  response: unknown,
  options: ChildTranscriptOptions = {},
): ChildTerminalEvidence {
  const data =
    isRecord(response) && Array.isArray(response.data)
      ? (response.data as unknown[])
      : [];
  const messages = data.filter(isRecord) as LooseMessage[];
  if (messages.length === 0) return { kind: 'no-assistant' };

  const baselineIndex = options.baselineMessageID
    ? messages.findIndex((m) => m.info?.id === options.baselineMessageID)
    : -1;
  if (options.baselineMessageID && baselineIndex < 0) {
    return { kind: 'no-new-messages' };
  }
  const lastIndex = messages.length - 1;
  if (baselineIndex >= 0 && lastIndex <= baselineIndex) {
    return { kind: 'no-new-messages' };
  }

  let targetIndex = lastIndex;
  if (
    options.scanBackToLastAssistant &&
    messages[targetIndex].info?.role !== 'assistant'
  ) {
    targetIndex = -1;
    for (let i = lastIndex; i >= 0; i -= 1) {
      if (messages[i].info?.role === 'assistant') {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex < 0) return { kind: 'no-assistant' };
  }

  const last = messages[targetIndex];
  if (last.info?.role !== 'assistant') return { kind: 'no-assistant' };

  const requireCompletionTime = options.requireCompletionTime ?? true;
  const finish = last.info?.finish;
  if (finish === 'tool-calls' || finish === 'unknown') {
    return { kind: 'pending' };
  }
  if (
    requireCompletionTime &&
    !(isRecord(last.info?.time) && typeof last.info.time.completed === 'number')
  ) {
    return { kind: 'pending' };
  }

  const postBaseline = messages.slice(baselineIndex + 1);
  const hasPendingToolCall = postBaseline.some((message) =>
    (Array.isArray(message.parts) ? message.parts : []).some((part) => {
      if (!isRecord(part) || part.type !== 'tool') return false;
      const status = isRecord(part.state)
        ? typeof part.state.status === 'string'
          ? part.state.status
          : undefined
        : undefined;
      return status !== 'completed' && status !== 'error';
    }),
  );
  if (hasPendingToolCall) return { kind: 'pending' };

  if (last.info?.error !== undefined && last.info?.error !== null) {
    return { kind: 'error', errorText: stringifyError(last.info.error) };
  }

  const text = (Array.isArray(last.parts) ? last.parts : [])
    .filter(
      (part) =>
        isRecord(part) &&
        part.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.length > 0,
    )
    .map((part) => (part as { text: string }).text)
    .join('\n\n')
    .trim();
  return text.length > 0 ? { kind: 'ready', text } : { kind: 'textless' };
}
