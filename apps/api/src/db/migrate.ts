import { Migrator, FileMigrationProvider } from 'kysely';
import { db } from './client.js';
import * as path from 'path';
import * as fs from 'fs/promises';

const migrationFolder = path.join(import.meta.dirname, 'migrations');

async function migrateToLatest() {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

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

migrateToLatest();
