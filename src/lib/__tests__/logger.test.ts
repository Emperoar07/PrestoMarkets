import { logger } from '../logger';

describe('logger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('log level methods', () => {
    it('debug logs to console.log with debug level', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.debug('test-context', 'debug message');

      const entry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(entry.level).toBe('debug');
      expect(entry.context).toBe('test-context');
      expect(entry.message).toBe('debug message');
      expect(entry.timestamp).toBeDefined();
    });

    it('info logs to console.log with info level', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.info('test-context', 'info message');

      const entry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(entry.level).toBe('info');
      expect(entry.context).toBe('test-context');
      expect(entry.message).toBe('info message');
    });

    it('warn logs to console.log with warn level', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.warn('test-context', 'warn message');

      const entry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(entry.level).toBe('warn');
      expect(entry.context).toBe('test-context');
      expect(entry.message).toBe('warn message');
    });

    it('error logs to console.error with error level', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      logger.error('test-context', 'error message');

      const entry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(entry.level).toBe('error');
      expect(entry.context).toBe('test-context');
      expect(entry.message).toBe('error message');
    });
  });

  describe('data parameter', () => {
    it('includes optional data object when provided', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const testData = { userId: 'abc', amount: 100 };
      logger.info('test', 'message', testData);

      const entry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(entry.data).toEqual(testData);
    });

    it('excludes data property when not provided', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.info('test', 'message');

      const entry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(entry.data).toBeUndefined();
    });
  });

  describe('JSON format', () => {
    it('formats log entries as valid JSON with required fields', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.warn('test-context', 'test message', { data: 'value' });

      const logCall = consoleSpy.mock.calls[0][0];
      const entry = JSON.parse(logCall);

      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('context');
      expect(entry).toHaveProperty('message');
      expect(entry).toHaveProperty('data');
      expect(new Date(entry.timestamp)).toBeInstanceOf(Date);
    });
  });
});
