// photos table queries. Owner: Himagna (data branch).
// Photos are stored as bytea; the backend serves them at /photos/:id.

import type { Db } from "../types";
import { isUuid, type Sql } from "./client";

type PhotoQueries = Pick<Db, "savePhoto" | "getPhoto">;

type PhotoRow = { bytes: Uint8Array; mimeType: string };

export function photosQueries(sql: Sql): PhotoQueries {
  return {
    async savePhoto(bytes, mimeType) {
      // The driver wants a Buffer for bytea, so copy the Uint8Array into one.
      const [row] = await sql<{ id: string }[]>`
        insert into photos (bytes, mime_type) values (${Buffer.from(bytes)}, ${mimeType})
        returning id
      `;
      return row!.id;
    },

    async getPhoto(id) {
      if (!isUuid(id)) return null;
      const [row] = await sql<PhotoRow[]>`select bytes, mime_type from photos where id = ${id}`;
      if (!row) return null;
      return { bytes: new Uint8Array(row.bytes), mimeType: row.mimeType };
    },
  };
}
