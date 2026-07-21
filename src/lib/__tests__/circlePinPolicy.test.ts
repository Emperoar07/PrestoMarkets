import { describe, expect, it } from 'vitest';
import { isCirclePinFlowEnabled } from '../circlePinPolicy';

describe('isCirclePinFlowEnabled', () => {
  it('fails closed for PIN-only Circle identity in production', () => {
    expect(isCirclePinFlowEnabled({ nodeEnv: 'production' })).toBe(false);
  });

  it('requires an explicit production opt-in', () => {
    expect(isCirclePinFlowEnabled({ nodeEnv: 'production', configured: 'true' })).toBe(true);
  });

  it('keeps local development usable without an extra environment variable', () => {
    expect(isCirclePinFlowEnabled({ nodeEnv: 'development' })).toBe(true);
  });
});
