import { logger } from '../logger';

describe('logger', () => {
  it('formats log entries as JSON with context', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    logger.warn('test-context', 'test message', { data: 'value' });

    const logCall = consoleSpy.mock.calls[0][0];
    expect(logCall).toContain('test-context');
    expect(logCall).toContain('test message');
    expect(logCall).toContain('warn');

    consoleSpy.mockRestore();
  });

  it('error method uses console.error', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    logger.error('test-context', 'error message');

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
