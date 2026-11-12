/**
 * Unit tests for idempotency key generation
 */

import { describe, it, expect } from 'vitest';
import { generateIdempotencyKey, generateImageJobIdempotencyKey } from '../idempotency';
import type { ActionInput } from '@shared/schema';

describe('idempotency', () => {
  describe('generateIdempotencyKey', () => {
    it('should generate deterministic keys for same inputs', () => {
      const actionPayload: ActionInput = {
        gameId: 'test-game-123',
        action: 'repair',
        customText: 'Fix the engine'
      };

      const key1 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, actionPayload);
      const key2 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, actionPayload);

      expect(key1).toBe(key2);
      expect(key1).toContain('turn-precompute');
      expect(key1).toContain('test-game-123');
      expect(key1).toContain('5');
    });

    it('should generate different keys for different actions', () => {
      const action1: ActionInput = {
        gameId: 'test-game-123',
        action: 'repair',
        customText: 'Fix the engine'
      };
      const action2: ActionInput = {
        gameId: 'test-game-123',
        action: 'explore',
        customText: 'Check the stars'
      };

      const key1 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, action1);
      const key2 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, action2);

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different turn numbers', () => {
      const actionPayload: ActionInput = {
        gameId: 'test-game-123',
        action: 'repair',
        customText: 'Fix the engine'
      };

      const key1 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, actionPayload);
      const key2 = generateIdempotencyKey('turn-precompute', 'test-game-123', 6, actionPayload);

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different queues', () => {
      const actionPayload: ActionInput = {
        gameId: 'test-game-123',
        action: 'repair',
        customText: 'Fix the engine'
      };

      const key1 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, actionPayload);
      const key2 = generateIdempotencyKey('turn-apply', 'test-game-123', 5, actionPayload);

      expect(key1).not.toBe(key2);
    });

    it('should handle action payloads with different property orders', () => {
      const action1: ActionInput = {
        gameId: 'test-game-123',
        action: 'repair',
        customText: 'Fix the engine'
      };
      const action2: ActionInput = {
        action: 'repair',
        gameId: 'test-game-123',
        customText: 'Fix the engine'
      };

      const key1 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, action1);
      const key2 = generateIdempotencyKey('turn-precompute', 'test-game-123', 5, action2);

      // Should be the same because canonical JSON stringify sorts keys
      expect(key1).toBe(key2);
    });
  });

  describe('generateImageJobIdempotencyKey', () => {
    it('should generate deterministic keys for same image job ID', () => {
      const key1 = generateImageJobIdempotencyKey('image-job-123');
      const key2 = generateImageJobIdempotencyKey('image-job-123');

      expect(key1).toBe(key2);
      expect(key1).toBe('image:image-job-123');
    });

    it('should generate different keys for different image job IDs', () => {
      const key1 = generateImageJobIdempotencyKey('image-job-123');
      const key2 = generateImageJobIdempotencyKey('image-job-456');

      expect(key1).not.toBe(key2);
    });
  });
});

