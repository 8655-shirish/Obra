// The generated Supabase types declare every RPC argument as non-nullable even
// when the SQL function accepts NULL. These helpers keep call sites honest
// without editing the auto-generated types file.
export const rpcNull = null as unknown as string;

export function rpcNullable<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}
