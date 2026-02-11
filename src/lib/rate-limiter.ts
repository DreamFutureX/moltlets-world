// ============================================================
// Moltlets Town - Rate Limiter (High-Load Protection)
// ============================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a request should be allowed
   * @returns true if allowed, false if rate limited
   */
  check(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now >= entry.resetAt) {
      // New window
      this.limits.set(key, {
        count: 1,
        resetAt: now + config.windowMs,
      });
      return { allowed: true, remaining: config.maxRequests - 1, resetIn: config.windowMs };
    }

    if (entry.count >= config.maxRequests) {
      // Rate limited
      return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
    }

    // Increment counter
    entry.count++;
    return { allowed: true, remaining: config.maxRequests - entry.count, resetIn: entry.resetAt - now };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetAt) {
        this.limits.delete(key);
      }
    }
  }

  /**
   * Get current stats
   */
  getStats(): { activeKeys: number } {
    return { activeKeys: this.limits.size };
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton instance
const globalForLimiter = globalThis as unknown as { __rateLimiter?: RateLimiter };
if (!globalForLimiter.__rateLimiter) {
  globalForLimiter.__rateLimiter = new RateLimiter();
}
export const rateLimiter = globalForLimiter.__rateLimiter;

// ═══════════════════════════════════════════════════════════
// RATE LIMIT CONFIGURATIONS
// ═══════════════════════════════════════════════════════════

// Per-agent action rate limit (prevent spam)
export const AGENT_ACTION_LIMIT: RateLimitConfig = {
  windowMs: 1000,      // 1 second window
  maxRequests: 5,      // Max 5 actions per second per agent
};

// Per-IP join rate limit (prevent bot floods)
export const JOIN_LIMIT: RateLimitConfig = {
  windowMs: 60000,     // 1 minute window
  maxRequests: 10,     // Max 10 joins per minute per IP
};

// Global action rate limit (server protection)
export const GLOBAL_ACTION_LIMIT: RateLimitConfig = {
  windowMs: 1000,      // 1 second window
  maxRequests: 500,    // Max 500 total actions per second globally
};

// Per-IP look rate limit
export const LOOK_LIMIT: RateLimitConfig = {
  windowMs: 1000,      // 1 second window
  maxRequests: 10,     // Max 10 looks per second per agent
};

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Extract IP address from request
 */
export function getClientIP(request: Request): string {
  // Check common proxy headers
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback to a default (localhost)
  return '127.0.0.1';
}

/**
 * Check rate limit and return error response if exceeded
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; response?: Response } {
  const result = rateLimiter.check(key, config);

  if (!result.allowed) {
    return {
      allowed: false,
      response: new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfterMs: result.resetIn,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil(result.resetIn / 1000).toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Math.ceil(result.resetIn / 1000).toString(),
          },
        },
      ),
    };
  }

  return { allowed: true };
}
