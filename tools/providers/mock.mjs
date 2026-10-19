// Test provider: returns the contents of MOCK_RESPONSE_FILE (or MOCK_RESPONSE) as the model answer.
import fs from 'node:fs';

export const name = 'mock';
export const model = 'mock';
export async function generate() {
  if (process.env.MOCK_RESPONSE_FILE) return fs.readFileSync(process.env.MOCK_RESPONSE_FILE, 'utf8');
  return process.env.MOCK_RESPONSE || '{"items":[]}';
}
