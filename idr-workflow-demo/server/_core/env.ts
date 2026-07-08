export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  openAiApiUrl: process.env.BUILT_IN_OPENAI_API_URL ?? "",
  openAiApiKey: process.env.BUILT_IN_OPENAI_API_KEY ?? "",
  storageApiUrl: process.env.BUILT_IN_STORAGE_API_URL ?? "",
  storageApiKey: process.env.BUILT_IN_STORAGE_API_KEY ?? "",
};
