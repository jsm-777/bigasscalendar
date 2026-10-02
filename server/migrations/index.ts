// Migrations ship as strings so they are bundled into the serverless function.
import m001 from './001_init.ts';

export const MIGRATIONS: [string, string][] = [['001_init', m001]];
