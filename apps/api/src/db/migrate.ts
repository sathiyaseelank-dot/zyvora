// Kysely 0.29 moved the migration API to its own entrypoint.
import { Migrator, FileMigrationProvider } from 'kysely/migration';
import { db } from './client.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// Usage:
//   npm run migrate         apply every pending migration
//   npm run migrate:down    roll back the most recent applied migration
//
// Both migrations define `down()`, but until now there was no command that
// reached them — so the rollback half of E2-S1 ("Migrations roll back") existed
// as code nobody could invoke. `migrate:down` takes no argument on purpose:
// rolling back by name invites pointing it at the wrong migration.
const direction = process.argv[2] === 'down' ? 'down' : 'up';
const migrationFolder = path.join(import.meta.dirname, 'migrations');

async function run(): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });

  const { error, results } =
    direction === 'down'
      ? await migrator.migrateDown()
      : await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === 'Success') {
      console.log(`Migration "${it.migrationName}" executed successfully`);
    } else if (it.status === 'Error') {
      console.error(`Failed to execute migration "${it.migrationName}"`);
    }
  });

  if (error) {
    console.error('Failed to migrate:', error);
    process.exit(1);
  }

  await db.destroy();
}

run().catch((err) => {
  console.error('migrate failed:', err);
  process.exit(1);
});
