import { describe, expect, test } from 'bun:test';
import {
  createPendingCallTracker,
  type PendingTaskCall,
} from './pending-call-tracker';

function pending(overrides: Partial<PendingTaskCall>): PendingTaskCall {
  return {
    callId: 'call-1',
    parentSessionId: 'parent-1',
    agentType: 'oracle',
    label: 'Review thing',
    background: true,
    lifecycleEpoch: 0,
    ...overrides,
  };
}

describe('peekByParentAndAgent', () => {
  test('title match wins among same-agent parallel pendings', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', label: 'L1' }));
    tracker.add(pending({ callId: 'b', label: 'L2' }));
    tracker.add(pending({ callId: 'c', label: 'L3' }));

    const hit = tracker.peekByParentAndAgent('parent-1', 'oracle', 'L2');

    expect(hit?.callId).toBe('b');
  });

  test('title present but no label match refuses instead of falling back to agent', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', label: 'L1' }));

    const hit = tracker.peekByParentAndAgent('parent-1', 'oracle', 'L9');

    expect(hit).toBeUndefined();
  });

  test('duplicate labels with matching title refuse', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', label: 'L1' }));
    tracker.add(pending({ callId: 'b', label: 'L1' }));

    const hit = tracker.peekByParentAndAgent('parent-1', 'oracle', 'L1');

    expect(hit).toBeUndefined();
  });

  test('unique agent match still wins without title (council reviewers)', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', agentType: 'fixer' }));
    tracker.add(pending({ callId: 'b', agentType: 'oracle' }));

    const hit = tracker.peekByParentAndAgent('parent-1', 'oracle');

    expect(hit?.callId).toBe('b');
  });

  test('multiple same-agent pendings without title refuse (incident case)', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a' }));
    tracker.add(pending({ callId: 'b' }));
    tracker.add(pending({ callId: 'c' }));

    expect(tracker.peekByParentAndAgent('parent-1', 'oracle')).toBeUndefined();
  });

  test('skips pendings that are early-registered or fenced', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', earlyRegisteredTaskID: 'ses_x' }));
    tracker.add(pending({ callId: 'b', earlyRegistrationRejected: true }));

    expect(tracker.peekByParentAndAgent('parent-1', 'oracle')).toBeUndefined();
  });

  test('single unmarked pending without agent hint is returned', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', agentType: 'fixer' }));

    const hit = tracker.peekByParentAndAgent('parent-1');

    expect(hit?.callId).toBe('a');
  });

  test('title match is constrained by the agent hint', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', agentType: 'fixer', label: 'L1' }));
    tracker.add(pending({ callId: 'b', agentType: 'oracle', label: 'L2' }));

    // The title matches pending b, but the child's agent is fixer: the
    // oracle pending must not be claimed across agents.
    const hit = tracker.peekByParentAndAgent('parent-1', 'fixer', 'L2');

    expect(hit).toBeUndefined();
  });

  test('stale no-title claim is rejected after a same-agent call was consumed', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a' }));
    tracker.add(pending({ callId: 'b' }));

    // call a's after-hook consumed its pending; a late no-title
    // session.created may be a's stale child and must not claim b.
    tracker.take('a');

    expect(tracker.peekByParentAndAgent('parent-1', 'oracle')).toBeUndefined();
  });

  test('no-title unique-agent claim still works before any consumption', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', agentType: 'oracle' }));
    tracker.add(pending({ callId: 'b', agentType: 'fixer' }));

    const hit = tracker.peekByParentAndAgent('parent-1', 'oracle');

    expect(hit?.callId).toBe('a');
  });

  test('consumed-call staleness guard is scoped by agent', () => {
    const tracker = createPendingCallTracker();
    tracker.add(pending({ callId: 'a', agentType: 'oracle' }));
    tracker.add(pending({ callId: 'b', agentType: 'fixer' }));

    tracker.take('a');

    // The consumed oracle call cannot explain a fixer child.
    const hit = tracker.peekByParentAndAgent('parent-1', 'fixer');

    expect(hit?.callId).toBe('b');
  });
});
