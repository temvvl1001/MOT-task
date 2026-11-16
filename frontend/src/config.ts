// Everything environment-specific comes from VITE_* variables (see .env.example).
export const config = {
  apiUrl: (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, ''),
  wsUrl: import.meta.env.VITE_WS_URL ?? '',
  region: import.meta.env.VITE_COGNITO_REGION ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
};

const REQUIRED = {
  VITE_API_URL: config.apiUrl,
  VITE_WS_URL: config.wsUrl,
  VITE_COGNITO_REGION: config.region,
  VITE_COGNITO_CLIENT_ID: config.clientId,
};

// Names of the variables that are missing, so the app can say so instead of failing silently.
export const missingConfig = (): string[] =>
  Object.entries(REQUIRED)
    .filter(([, value]) => !value)
    .map(([name]) => name);
