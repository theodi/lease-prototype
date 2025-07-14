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
    service: process.env.EMAIL_SERVICE,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  search: {
    dailyLimit: parseInt(process.env.DAILY_SEARCH_LIMIT) || 10
  },
  bookmarks: {
    limit: parseInt(process.env.BOOKMARK_LIMIT) || 5
  },
  govuk: {
    apiKey: process.env.GOVUK_API_KEY,
  }
};

export default config;
