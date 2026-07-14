export async function qAll<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const { results } = await stmt.all<T>();
  return results ?? [];
}
