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
});
