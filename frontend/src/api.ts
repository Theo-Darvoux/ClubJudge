export interface HealthResponse {
  status: string;
  version: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const resp = await fetch('/api/health');
  if (!resp.ok) throw new Error(`API responded ${resp.status}`);
  return resp.json();
}
