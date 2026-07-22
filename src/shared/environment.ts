export type CodlokEnvironment = 'development' | 'staging' | 'production';

export function codlokEnvironment(): CodlokEnvironment {
  const configured = process.env.CODELOK_ENVIRONMENT;
  if (
    configured === 'development' ||
    configured === 'staging' ||
    configured === 'production'
  ) {
    return configured;
  }
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}
