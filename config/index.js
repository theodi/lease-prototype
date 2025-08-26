const config = {
  isDevelopment: process.env.NODE_ENV === 'development',
  isTesting: process.env.NODE_ENV === 'testing',
  allowedDomains: process.env.ALLOWED_DOMAINS
  ? process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim().toLowerCase())
  : [],
  devVerificationCode: process.env.DEV_VERIFICATION_CODE || '123456',
  port: process.env.PORT || 3000,
  sessionSecret: process.env.SESSION_SECRET,
  mongodbUri: process.env.MONGODB_URI,
  baseUrl: process.env.BASE_URL,
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini'
  },
  email: {
    method: process.env.EMAIL_METHOD || 'smtp',
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 25,
    from: process.env.EMAIL_FROM,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  search: {
    dailyLimit: parseInt(process.env.DAILY_SEARCH_LIMIT) || 10,
    maxConcurrentSearches: parseInt(process.env.MAX_CONCURRENT_SEARCHES) || 50,
    maxTimeMS: parseInt(process.env.SEARCH_MAX_TIME_MS) || 2500,
    overloadThreshold: {
      activeSearches: parseInt(process.env.SEARCH_OVERLOAD_ACTIVE) || 40,
      p95Latency: parseInt(process.env.SEARCH_OVERLOAD_P95_LATENCY) || 2000
    },
    loadTracking: {
      latencyWindowSize: parseInt(process.env.SEARCH_LATENCY_WINDOW_SIZE) || 100,
      latencyWindowMinutes: parseInt(process.env.SEARCH_LATENCY_WINDOW_MINUTES) || 5
    },
    rateLimiting: {
      maxFailedAttempts: parseInt(process.env.SEARCH_MAX_FAILED_ATTEMPTS) || 3,
      failedQueryResetTime: parseInt(process.env.SEARCH_FAILED_QUERY_RESET_TIME) || 60000 // 1 minute
    }
  },
  bookmarks: {
    limit: parseInt(process.env.BOOKMARK_LIMIT) || 5
  },
  govuk: {
    apiKey: process.env.GOVUK_API_KEY,
  }
};

export default config;
