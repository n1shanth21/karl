// users table queries. Owner: Himagna (data branch).
// This file is the PATTERN for every other src/db/pg/<table>.ts file:
//   - export one function `<table>Queries(sql)` returning the Db methods for that table
//   - list columns explicitly (never select *), camelCase conversion is automatic
//   - get* returns null for a missing or malformed id; update* throws "<thing> not found"

import type postgres from "postgres";
import type { User } from "../../types";
import type { Db, UserPatch } from "../types";
import { defined, isUuid, type Sql } from "./client";

type UserQueries = Pick<Db, "getUser" | "getUserByPhone" | "createUser" | "updateUser">;

export function usersQueries(sql: Sql): UserQueries {
  const cols = sql`id, phone, space_id, first_name, opted_out, state, created_at`;

  return {
    async getUser(id) {
      if (!isUuid(id)) return null;
      const [row] = await sql<User[]>`select ${cols} from users where id = ${id}`;
      return row ?? null;
    },

    async getUserByPhone(phone) {
      const [row] = await sql<User[]>`select ${cols} from users where phone = ${phone}`;
      return row ?? null;
    },

    async createUser({ phone, spaceId }) {
      const [row] = await sql<User[]>`
        insert into users (phone, space_id) values (${phone}, ${spaceId})
        returning ${cols}
      `;
      return row!;
    },

    async updateUser(id, patch: UserPatch) {
      const changes = defined(patch) as Record<string, postgres.ParameterOrJSON<never>>;
      // jsonb columns must be wrapped with sql.json so the object is stored as JSON.
      if (changes.state !== undefined) changes.state = sql.json(changes.state as postgres.JSONValue) as postgres.ParameterOrJSON<never>;
      const keys = Object.keys(changes);

      if (!isUuid(id)) throw new Error("user not found");
      const [row] = keys.length
        ? await sql<User[]>`update users set ${sql(changes, keys)} where id = ${id} returning ${cols}`
        : await sql<User[]>`select ${cols} from users where id = ${id}`;
      if (!row) throw new Error("user not found");
      return row;
    },
  };
}
