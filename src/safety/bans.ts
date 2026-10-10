// Users banned for sending explicit photos. Once banned, Karl ignores them
// completely, and "start" does not undo it (unlike "stop").
// In-memory only: a server restart clears the list (fine for the hackathon).

const banned = new Set<string>();

export function banUser(userId: string): void {
  banned.add(userId);
  console.log(`[safety] banned user ${userId}`);
}

export function isBanned(userId: string): boolean {
  return banned.has(userId);
}
