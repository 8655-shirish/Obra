declare module "eslint-scope" {
  type Reference = { identifier: { name: string } };
  type Scope = { through: Reference[]; variables: Array<{ name: string }> };
  type ScopeManager = { globalScope: Scope | null };

  export function analyze(
    ast: object,
    options: { ecmaVersion: number; sourceType: "script" | "module" },
  ): ScopeManager;
}
