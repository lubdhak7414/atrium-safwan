export function retryDelay(attempt: number): number {
  return [60, 300, 1800, 7200][Math.min(Math.max(attempt - 1, 0), 3)] * 1000;
}

export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}
