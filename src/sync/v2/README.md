# Encrypted sync v2

Sync v2 is implemented but deliberately inactive. The existing application switch remains off, and the Worker requires both `SYNC_V2_ENABLED=true` and a valid comma-separated `SYNC_V2_ALLOWED_ORIGINS` value before any v2 request is served.

## Security model

- The client generates a 256-bit AES-GCM data key. The Worker never receives it.
- Entity ciphertext is authenticated with AAD containing the household, entity type and ID, schema version, mutation ID, and operation.
- Only `medication`, `schedule`, and `intake` envelopes pass runtime validation. Work and income DTOs are rejected.
- Device credentials use `Authorization: Bearer <device-token>` only. The Worker stores SHA-256 token hashes, supports self-rotation, and allows an authenticated device to revoke another device.
- One-time pairing secrets expire after ten minutes and are stored only as hashes. The pairing URI keeps both the pairing secret and recovery code in its fragment, so neither appears in a URL sent to the Worker.
- Each household is serialized by one Durable Object. Mutations have unique IDs, durable idempotency receipts, client-supplied base entity revisions, and server-assigned entity and household revisions.

## HTTP interface

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v2/households` | none | Create a household and its first device |
| `POST` | `/api/v2/households/:id/pairing-codes` | Bearer | Issue one expiring pairing secret |
| `POST` | `/api/v2/households/:id/pair` | `X-Medbox-Pairing-Code` | Consume the secret and create a device |
| `GET` | `/api/v2/households/:id/devices` | Bearer | List device IDs and revocation state |
| `POST` | `/api/v2/households/:id/devices/:deviceId/rotate` | Bearer (self) | Rotate a device token |
| `DELETE` | `/api/v2/households/:id/devices/:deviceId` | Bearer | Revoke a device and its unused pairing codes |
| `POST` | `/api/v2/households/:id/sync` | Bearer | Push revision-checked mutations and pull encrypted changes |

All API responses are `no-store`. Browser origins must match the configured allowlist exactly. JSON request size, mutation count, field length, entity count, and ciphertext size are bounded before Durable Object writes.

Legacy `/api/sync` is disabled unless `SYNC_V1_READONLY_ENABLED=true`; even then it accepts only authenticated `GET` requests. The shared-key Worker AI route returns `410`.
