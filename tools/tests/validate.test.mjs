import { test } from 'node:test';
import { cases } from './cases.mjs';

for (const [name, fn] of Object.entries(cases)) test(name, fn);
