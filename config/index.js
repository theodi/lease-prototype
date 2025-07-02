const config = {
  isDevelopment: process.env.NODE_ENV === 'development',
  devVerificationCode: process.env.DEV_VERIFICATION_CODE || '123456',
  port: process.env.PORT || 3000,
  sessionSecret: process.env.SESSION_SECRET,
  mongodbUri: process.env.MONGODB_URI,
  openAiApiKey: process.env.OPENAI_API_KEY || 'testing',
  email: {
    service: process.env.EMAIL_SERVICE,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  search: {
    dailyLimit: parseInt(process.env.DAILY_SEARCH_LIMIT) || 10
  }
};

export default config;
