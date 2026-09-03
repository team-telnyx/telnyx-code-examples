import { Agent, env, CloudFS, SQL } from '@telnyx/edge-sdk'

// --- MigrationAgent: orchestrates SQL schema migrations across actor instances ---
class MigrationAgent extends Agent {
  // Queue a migration rollout across multiple instances
  async queue(migrationName: string, instances: string[]) {
    for (const instance of instances) {
      this.queue(`migrate-${instance}`, async () => {
        await this.runMigration(instance, migrationName)
      })
    }
  }

  // Each instance: read version from SQL -> apply CloudFS migration -> update SQL version
  private async runMigration(instance: string, migrationName: string) {
    const sql = new SQL(env.SQL_CONNECTION_STRING)
    const fs = new CloudFS(env.CLOUDFS_BUCKET)

    try {
      // Read current schema version from SQL DB
      const versionRow = await sql.query(
        'SELECT version FROM schema_version WHERE instance = ? LIMIT 1',
        [instance]
      )
      const currentVersion = versionRow.length > 0 ? versionRow[0].version : 0

      // Read migration script from CloudFS shared directory
      const script = await fs.read(`migrations/${migrationName}.sql`)

      // Apply migration script
      await sql.exec(script)

      // Update SQL version table
      const newVersion = currentVersion + 1
      if (versionRow.length > 0) {
        await sql.exec(
          'UPDATE schema_version SET version = ? WHERE instance = ?',
          [newVersion, instance]
        )
      } else {
        await sql.exec(
          'INSERT INTO schema_version (instance, version) VALUES (?, ?)',
          [instance, newVersion]
        )
      }

      // Send SMS notification via Telnyx binding
      if (env.SMS_RECIPIENT) {
        await this.env.TELNYX.messages.send({
          from: env.SMS_FROM,
          to: env.SMS_RECIPIENT,
          text: `Migration '${migrationName}' applied to instance '${instance}' (version ${newVersion}).`
        })
      }
    } catch (err) {
      // Rollback on failure
      await this.rollback(instance, migrationName, sql)
      if (env.SMS_RECIPIENT) {
        await this.env.TELNYX.messages.send({
          from: env.SMS_FROM,
          to: env.SMS_RECIPIENT,
          text: `Migration '${migrationName}' FAILED on instance '${instance}'. Rolled back. Error: ${err instanceof Error ? err.message : String(err)}`
        })
      }
      throw err
    }
  }

  // Rollback: reverse the migration script
  private async rollback(instance: string, migrationName: string, sql: SQL) {
    try {
      const fs = new CloudFS(env.CLOUDFS_BUCKET)
      const rollbackScript = await fs.read(`migrations/${migrationName}_rollback.sql`)
      await sql.exec(rollbackScript)

      // Decrement version
      await sql.exec(
        'UPDATE schema_version SET version = version - 1 WHERE instance = ? AND version > 0',
        [instance]
      )
    } catch (rollbackErr) {
      console.error(`Rollback failed for ${migrationName} on ${instance}:`, rollbackErr)
    }
  }
}

// --- Default export: Edge app handler ---
export default {
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/migrate') {
      try {
        const body = await request.json()
        const { migrationName, instances } = body

        if (!migrationName || !Array.isArray(instances)) {
          return new Response(JSON.stringify({ error: 'migrationName and instances required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        const agent = new MigrationAgent(env)
        await agent.queue(migrationName, instances)

        return new Response(JSON.stringify({ status: 'queued', migrationName, instances }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (err) {
        console.error('Migration error:', err)
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response('Not found', { status: 404 })
  }
}
