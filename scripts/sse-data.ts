// Stateless Streamable HTTP may answer a call as plain JSON or as one SSE event; return the JSON payload either way.
export const parseSseData = (body: string): any => {
  const line = body.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5) : body);
};
