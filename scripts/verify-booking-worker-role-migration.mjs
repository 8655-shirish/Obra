import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260829093918_booking_worker_role.sql";

function tokenizeSql(source) {
  const tokens = [];
  const isIdentifierStart = (value) => /[A-Za-z_]/.test(value ?? "");
  const isIdentifierPart = (value) => /[A-Za-z0-9_$]/.test(value ?? "");
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === "/" && source[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (source[index] === "*" && source[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) throw new Error("unterminated SQL block comment");
      continue;
    }

    if (char === "'") {
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!closed) throw new Error("unterminated SQL string literal");
      tokens.push({ kind: "string", value });
      continue;
    }

    if (char === '"') {
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          value += '"';
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!closed) throw new Error("unterminated quoted SQL identifier");
      tokens.push({ kind: "identifier", value, quoted: true });
      continue;
    }

    if (char === "$") {
      const delimiter = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const bodyStart = index + delimiter.length;
        const bodyEnd = source.indexOf(delimiter, bodyStart);
        if (bodyEnd < 0) throw new Error("unterminated dollar-quoted SQL body");
        tokens.push(...tokenizeSql(source.slice(bodyStart, bodyEnd)));
        index = bodyEnd + delimiter.length;
        continue;
      }
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < source.length && isIdentifierPart(source[index])) index += 1;
      tokens.push({
        kind: "identifier",
        value: source.slice(start, index).toLowerCase(),
        quoted: false,
      });
      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9]/.test(source[index])) index += 1;
      tokens.push({ kind: "number", value: source.slice(start, index) });
      continue;
    }

    tokens.push({ kind: "symbol", value: char });
    index += 1;
  }

  return tokens;
}

const key = (token) => `${token.kind}:${token.value}`;
const identifier = (value) => `identifier:${value}`;
const symbol = (value) => `symbol:${value}`;
const string = (value) => `string:${value}`;
const number = (value) => `number:${value}`;

function containsSequence(keys, expected) {
  for (let start = 0; start <= keys.length - expected.length; start += 1) {
    if (expected.every((value, offset) => keys[start + offset] === value)) return true;
  }
  return false;
}

function verifyWorkerRoleMigration(sql) {
  const tokens = tokenizeSql(sql);
  const keys = tokens.map(key);

  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].kind === "identifier" &&
      tokens[index].value === "alter" &&
      tokens[index + 1].kind === "identifier" &&
      tokens[index + 1].value === "role" &&
      tokens[index + 2].kind === "identifier" &&
      tokens[index + 2].value === "booking_worker"
    ) {
      throw new Error("executable ALTER ROLE booking_worker is forbidden");
    }
  }

  const createStatements = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].kind === "identifier" &&
      tokens[index].value === "create" &&
      tokens[index + 1].kind === "identifier" &&
      tokens[index + 1].value === "role" &&
      tokens[index + 2].kind === "identifier" &&
      tokens[index + 2].value === "booking_worker"
    ) {
      let end = index + 3;
      while (end < tokens.length && !(tokens[end].kind === "symbol" && tokens[end].value === ";"))
        end += 1;
      if (end === tokens.length)
        throw new Error("unterminated CREATE ROLE booking_worker statement");
      createStatements.push(tokens.slice(index, end).map((token) => token.value));
    }
  }
  if (createStatements.length !== 1) {
    throw new Error(
      `expected exactly one executable CREATE ROLE booking_worker, found ${createStatements.length}`,
    );
  }
  const createOptions = new Set(createStatements[0]);
  for (const option of [
    "nologin",
    "nosuperuser",
    "nocreatedb",
    "nocreaterole",
    "noreplication",
    "nobypassrls",
    "noinherit",
  ]) {
    if (!createOptions.has(option)) throw new Error(`CREATE ROLE booking_worker missing ${option}`);
  }
  for (const option of [
    "login",
    "superuser",
    "createdb",
    "createrole",
    "replication",
    "bypassrls",
    "inherit",
  ]) {
    if (createOptions.has(option))
      throw new Error(`CREATE ROLE booking_worker contains unsafe ${option}`);
  }

  const assertion = [
    identifier("if"),
    identifier("not"),
    identifier("exists"),
    symbol("("),
    identifier("select"),
    number("1"),
    identifier("from"),
    identifier("pg_catalog"),
    symbol("."),
    identifier("pg_roles"),
    identifier("where"),
    identifier("rolname"),
    symbol("="),
    string("booking_worker"),
    identifier("and"),
    identifier("rolcanlogin"),
    symbol("="),
    identifier("false"),
    identifier("and"),
    identifier("rolsuper"),
    symbol("="),
    identifier("false"),
    identifier("and"),
    identifier("rolcreatedb"),
    symbol("="),
    identifier("false"),
    identifier("and"),
    identifier("rolcreaterole"),
    symbol("="),
    identifier("false"),
    identifier("and"),
    identifier("rolreplication"),
    symbol("="),
    identifier("false"),
    identifier("and"),
    identifier("rolbypassrls"),
    symbol("="),
    identifier("false"),
    identifier("and"),
    identifier("rolinherit"),
    symbol("="),
    identifier("false"),
    symbol(")"),
    identifier("then"),
    identifier("raise"),
    identifier("exception"),
    string("booking_worker role attributes are unsafe"),
    identifier("using"),
    identifier("errcode"),
    symbol("="),
    string("42501"),
    symbol(";"),
    identifier("end"),
    identifier("if"),
    symbol(";"),
  ];
  if (!containsSequence(keys, assertion)) {
    throw new Error(
      "executable fail-closed seven-attribute booking_worker assertion is missing or altered",
    );
  }

  for (const [option, value] of [
    ["admin", "false"],
    ["inherit", "true"],
    ["set", "true"],
  ]) {
    const dynamicGrant = `grant booking_worker to authenticator with ${option} ${value}`;
    if (!tokens.some((token) => token.kind === "string" && token.value === dynamicGrant)) {
      throw new Error(
        `PostgreSQL 16+ authenticator grant ${option}=${value} is missing or altered`,
      );
    }
  }

  for (const required of [
    "grantor.rolname=current_user",
    "grantor.rolname<>current_user",
    "grantor.rolsuper=true",
  ]) {
    const requiredTokens = tokenizeSql(required).map(key);
    if (!containsSequence(keys, requiredTokens)) {
      throw new Error(`booking_worker membership provenance predicate is missing: ${required}`);
    }
  }

  const globalDefaultClosure = [
    identifier("alter"),
    identifier("default"),
    identifier("privileges"),
    identifier("revoke"),
    identifier("execute"),
    identifier("on"),
    identifier("functions"),
    identifier("from"),
    identifier("public"),
    symbol(";"),
  ];
  if (!containsSequence(keys, globalDefaultClosure)) {
    throw new Error("global default PUBLIC function EXECUTE closure is missing");
  }
  if (
    containsSequence(keys, [
      identifier("alter"),
      identifier("default"),
      identifier("privileges"),
      identifier("in"),
      identifier("schema"),
      identifier("public"),
      identifier("revoke"),
      identifier("execute"),
    ])
  ) {
    throw new Error("schema-scoped default privilege revoke cannot close global PUBLIC EXECUTE");
  }

  for (const required of [
    "migration owner cannot close all PUBLIC function grants",
    "PUBLIC function EXECUTE revocation failed for %",
    "non-PUBLIC function ACL preservation failed for %",
    "application function authority preservation failed for %",
    "PUBLIC function EXECUTE closure is incomplete",
    "PUBLIC schema CREATE closure is incomplete",
    "booking_worker final role membership is unsafe",
  ]) {
    if (!tokens.some((token) => token.kind === "string" && token.value === required)) {
      throw new Error(`missing executable fail-closed ACL assertion: ${required}`);
    }
  }
}

function replaceOne(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error("mutation fixture must match exactly once");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function expectRejected(label, sql) {
  try {
    verifyWorkerRoleMigration(sql);
  } catch {
    return;
  }
  throw new Error(`mutation unexpectedly passed: ${label}`);
}

const sql = readFileSync(migrationPath, "utf8");
verifyWorkerRoleMigration(sql);

expectRejected("uppercase ALTER", sql + "\nALTER ROLE booking_worker NOLOGIN;\n");
expectRejected(
  "schema-scoped default privilege closure",
  replaceOne(
    sql,
    "alter default privileges revoke execute on functions from public;",
    "alter default privileges in schema public revoke execute on functions from public;",
  ),
);
expectRejected(
  "creator provenance accepts a named role",
  replaceOne(sql, "grantor.rolsuper=true", "grantor.rolname='postgres'"),
);
expectRejected(
  "bare authenticator grant",
  replaceOne(
    sql,
    "grant booking_worker to authenticator with inherit true",
    "grant booking_worker to authenticator",
  ),
);
expectRejected(
  "removed final-membership assertions",
  sql.replaceAll(
    "raise exception 'booking_worker final role membership is unsafe' using errcode='42501';",
    "perform 1;",
  ),
);
expectRejected(
  "removed owner preflight",
  replaceOne(
    sql,
    "raise exception 'migration owner cannot close all PUBLIC function grants' using errcode='42501';",
    "perform 1;",
  ),
);
expectRejected(
  "removed per-function revoke verification",
  replaceOne(
    sql,
    "raise exception 'PUBLIC function EXECUTE revocation failed for %',existing.procedure_identity using errcode='42501';",
    "perform 1;",
  ),
);
expectRejected(
  "removed application authority verification",
  replaceOne(
    sql,
    "raise exception 'application function authority preservation failed for %',existing.procedure_identity using errcode='42501';",
    "perform 1;",
  ),
);
expectRejected(
  "removed schema closure verification",
  replaceOne(
    sql,
    "raise exception 'PUBLIC schema CREATE closure is incomplete' using errcode='42501';",
    "perform 1;",
  ),
);
expectRejected(
  "removed ACL preservation verification",
  replaceOne(
    sql,
    "raise exception 'non-PUBLIC function ACL preservation failed for %',existing.procedure_identity using errcode='42501';",
    "perform 1;",
  ),
);
expectRejected("multi-space ALTER", sql + "\nalter    role    booking_worker noinherit;\n");
expectRejected("quoted ALTER", sql + '\nAlTeR /* gap */ RoLe "booking_worker" NOLOGIN;\n');
expectRejected(
  "comment-only CREATE",
  replaceOne(
    sql,
    "create role booking_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;",
    "/* create role booking_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit; */ perform 1;",
  ),
);
expectRejected(
  "unsafe CREATE",
  replaceOne(sql, "create role booking_worker nologin", "create role booking_worker login"),
);
expectRejected(
  "disabled assertion",
  replaceOne(
    sql,
    "if not exists(\n  select 1 from pg_catalog.pg_roles\n  where rolname='booking_worker'",
    "if false and not exists(\n  select 1 from pg_catalog.pg_roles\n  where rolname='booking_worker'",
  ),
);
expectRejected(
  "tautological assertion",
  replaceOne(
    sql,
    "and rolbypassrls=false and rolinherit=false\n )then",
    "and rolbypassrls=false and rolinherit=false or true\n )then",
  ),
);
expectRejected(
  "comment-only assertion",
  replaceOne(
    sql,
    "if not exists(\n  select 1 from pg_catalog.pg_roles\n  where rolname='booking_worker'\n   and rolcanlogin=false and rolsuper=false and rolcreatedb=false\n   and rolcreaterole=false and rolreplication=false\n   and rolbypassrls=false and rolinherit=false\n )then\n  raise exception 'booking_worker role attributes are unsafe' using errcode='42501';\n end if;",
    "/* if not exists(select 1 from pg_catalog.pg_roles where rolname='booking_worker' and rolcanlogin=false and rolsuper=false and rolcreatedb=false and rolcreaterole=false and rolreplication=false and rolbypassrls=false and rolinherit=false) then raise exception 'booking_worker role attributes are unsafe' using errcode='42501'; end if; */ perform 1;",
  ),
);

console.log("verify-booking-worker-role-migration: executable SQL and mutation contracts pass");
